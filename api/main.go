// Footprintz data API (Phase 5A): one Lambda function behind CloudFront /api/*.
// CloudFront reaches it through a function URL locked with origin access control,
// so every request here has already passed the WAF and been signed by CloudFront.
package main // a Go program that builds to one binary

import (
	"context"         // carries the request's deadline into AWS calls
	"encoding/base64" // decodes a body that Lambda passes base64-encoded
	"encoding/json"   // reads and writes JSON
	"errors"          // inspects AWS error types
	"io"              // io.EOF: "nothing left to read"
	"log"             // writes to CloudWatch Logs (stdout)
	"mime"            // parses the Content-Type header
	"os"              // reads environment variables
	"strconv"         // turns text into numbers
	"strings"         // wraps the body so the JSON decoder can read it

	"github.com/aws/aws-lambda-go/events"                 // the function URL request/response types
	"github.com/aws/aws-lambda-go/lambda"                 // runs the handler inside Lambda
	"github.com/aws/aws-sdk-go-v2/config"                 // loads the function's AWS credentials
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"       // the DynamoDB client
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types" // DynamoDB error types
)

const (
	scoresPath = "/api/scores" // the one route so far
	maxBody    = 1024          // largest POST body accepted, in bytes
	topN       = 10            // how many scores GET returns
)

// entry is one scoreboard line, as sent and returned in JSON.
type entry struct {
	Initials string `json:"initials"` // 3 letters A–Z
	Score    int64  `json:"score"`    // whole number, 0 to MAX_SCORE
}

// scoreStore is what the handler needs from storage; tests swap in a fake.
type scoreStore interface {
	top(ctx context.Context, n int32) ([]entry, error) // the n highest scores
	add(ctx context.Context, e entry) (int, error)     // store one entry; returns its place (0 = unknown)
}

// app holds what every request shares.
type app struct {
	scores   scoreStore // the DynamoDB table (or a test fake)
	maxScore int64      // plausibility cap from MAX_SCORE
}

// main runs once per cold start: read settings, connect, then serve requests.
func main() {
	table := os.Getenv("TABLE_NAME") // table name, set by OpenTofu
	if table == "" {                 // missing: refuse to start
		log.Fatal("TABLE_NAME is not set") // stops here; the request gets an error
	}
	maxScore, err := strconv.ParseInt(os.Getenv("MAX_SCORE"), 10, 64) // the cap, as a number
	if err != nil || maxScore < 0 {                                   // missing, not a number, or negative
		log.Fatal("MAX_SCORE must be a whole number of 0 or more") // refuse to start
	}
	cfg, err := config.LoadDefaultConfig(context.Background()) // credentials from the function's role
	if err != nil {                                            // can't load them
		log.Fatalf("load AWS config: %v", err) // refuse to start
	}
	a := &app{ // build the shared state
		scores:   &dynamoScores{db: dynamodb.NewFromConfig(cfg), table: table}, // real storage
		maxScore: maxScore,                                                     // the cap
	}
	lambda.Start(a.handle) // hand every request to a.handle, forever
}

// handle is the router: one path, two methods.
func (a *app) handle(ctx context.Context, req events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	if req.RawPath != scoresPath { // any other path under /api/
		return reply(404, errBody("not found")), nil // 404; nil = don't turn it into a Lambda error
	}
	switch req.RequestContext.HTTP.Method { // GET, POST, or anything else
	case "GET": // read the board
		return a.getScores(ctx), nil // top 10
	case "POST": // add an entry
		return a.postScore(ctx, req), nil // validate and store
	default: // PUT, DELETE, OPTIONS, HEAD, …
		r := reply(405, errBody("method not allowed")) // 405
		r.Headers["allow"] = "GET, POST"               // tell the client which methods work
		return r, nil                                  // send it
	}
}

// getScores returns the top scores as a JSON array.
func (a *app) getScores(ctx context.Context) events.LambdaFunctionURLResponse {
	list, err := a.scores.top(ctx, topN) // ask storage for the top 10
	if err != nil {                      // storage failed or was throttled
		return storeFailed(err) // 503 or 500, no details
	}
	if list == nil { // no rows yet
		list = []entry{} // send [] rather than null
	}
	body, _ := json.Marshal(list)   // can't fail: plain strings and numbers
	return reply(200, string(body)) // 200 with the list
}

// postScore checks one submitted entry and stores it.
func (a *app) postScore(ctx context.Context, req events.LambdaFunctionURLRequest) events.LambdaFunctionURLResponse {
	if !isJSON(req.Headers["content-type"]) { // function URLs lowercase header names
		return reply(415, errBody("send application/json")) // 415: wrong body type
	}
	raw := req.Body          // the body as Lambda passes it
	if req.IsBase64Encoded { // Lambda base64-encodes bodies it doesn't treat as text
		b, err := base64.StdEncoding.DecodeString(raw) // decode it
		if err != nil {                                // not valid base64
			return reply(400, errBody("bad request")) // 400
		}
		raw = string(b) // use the decoded bytes
	}
	if len(raw) > maxBody { // over 1 KB
		return reply(413, errBody("body too large")) // 413
	}
	e, ok := a.parseEntry(raw) // decode and check the fields
	if !ok {                   // anything wrong with it
		return reply(400, errBody("bad request")) // 400, without saying which part (no echo)
	}
	rank, err := a.scores.add(ctx, e) // store it and get its place
	if err != nil {                   // not stored
		return storeFailed(err) // 503 or 500
	}
	body, _ := json.Marshal(struct { // the answer: {"ok":true,"rank":132}
		OK   bool `json:"ok"`             // always true here
		Rank int  `json:"rank,omitempty"` // left out when the place is unknown (0)
	}{true, rank}) // can't fail: a bool and an int
	return reply(201, string(body)) // 201: created
}

// parseEntry accepts exactly {"initials":"ABC","score":N} and nothing else.
func (a *app) parseEntry(raw string) (entry, bool) {
	var in struct { // pointers, so a missing field is nil rather than "" or 0
		Initials *string `json:"initials"` // must be present
		Score    *int64  `json:"score"`    // must be present; 1.5 or "7" fail to decode
	}
	dec := json.NewDecoder(strings.NewReader(raw)) // decoder over the body
	dec.DisallowUnknownFields()                    // any extra field is an error
	if err := dec.Decode(&in); err != nil {        // not JSON, wrong types, extra fields
		return entry{}, false // reject
	}
	if _, err := dec.Token(); err != io.EOF { // anything after the object, e.g. a second object
		return entry{}, false // reject
	}
	if in.Initials == nil || in.Score == nil { // a field is missing
		return entry{}, false // reject
	}
	if !validInitials(*in.Initials) { // not exactly 3 letters A–Z
		return entry{}, false // reject
	}
	if *in.Score < 0 || *in.Score > a.maxScore { // outside 0 … MAX_SCORE
		return entry{}, false // reject
	}
	return entry{Initials: *in.Initials, Score: *in.Score}, true // accepted
}

// validInitials: exactly 3 bytes, each an uppercase ASCII letter.
func validInitials(s string) bool {
	if len(s) != 3 { // byte length, so "ÄBC" (4 bytes) fails too
		return false // wrong length
	}
	for i := 0; i < len(s); i++ { // each byte
		if s[i] < 'A' || s[i] > 'Z' { // not A–Z
			return false // reject
		}
	}
	return true // all three are A–Z
}

// isJSON: true if the Content-Type is application/json (a charset parameter is fine).
func isJSON(contentType string) bool {
	mt, _, err := mime.ParseMediaType(contentType) // split "application/json; charset=utf-8"
	return err == nil && mt == "application/json"  // only the type part counts
}

// storeFailed logs the real error and gives the client a short fixed answer.
func storeFailed(err error) events.LambdaFunctionURLResponse {
	log.Printf("store: %v", err)                           // full error to CloudWatch only
	var busy *types.ProvisionedThroughputExceededException // the "over capacity" error type
	if errors.As(err, &busy) {                             // the provisioned cap was hit
		return reply(503, errBody("busy, try again later")) // 503: try later
	}
	return reply(500, errBody("internal error")) // anything else: 500
}

// reply builds a JSON response that is never cached.
func reply(status int, body string) events.LambdaFunctionURLResponse {
	return events.LambdaFunctionURLResponse{ // the shape a function URL expects
		StatusCode: status, // HTTP status
		Headers: map[string]string{ // response headers
			"content-type":  "application/json", // always JSON
			"cache-control": "no-store",         // browsers and CloudFront keep no copy
		},
		Body: body, // the JSON text
	}
}

// errBody wraps a fixed message as {"error":"…"}.
func errBody(msg string) string {
	b, _ := json.Marshal(map[string]string{"error": msg}) // can't fail for a string map
	return string(b)                                      // the JSON text
}
