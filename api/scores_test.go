// Tests for the router, the input checks and the rank key. They use a fake store,
// so they need no AWS account and no network: run with `go test ./...`.
package main // same package, so the tests can reach unexported functions

import (
        "context"         // handler argument
        "encoding/base64" // builds a base64 body
        "errors"          // fake storage errors
        "sort"            // checks rank ordering
        "strings"         // builds an oversized body
        "testing"         // Go's test runner
        "time"            // times for rank keys

        "github.com/aws/aws-lambda-go/events"                 // request/response types
        "github.com/aws/aws-sdk-go-v2/service/dynamodb/types" // the throttling error type
)

// fakeStore stands in for DynamoDB.
type fakeStore struct {
        rows  []entry // what top returns
        added []entry // what add received
        err   error   // if set, every call fails with it
}

func (f *fakeStore) top(ctx context.Context, n int32) ([]entry, error) { return f.rows, f.err } // return the canned rows

func (f *fakeStore) add(ctx context.Context, e entry) error { // record the entry unless failing
        if f.err != nil { // failing store
                return f.err // fail
        }
        f.added = append(f.added, e) // remember it
        return nil                   // success
}

// request builds a function URL request the way CloudFront's forwarded call looks.
func request(method, path, contentType, body string) events.LambdaFunctionURLRequest {
        req := events.LambdaFunctionURLRequest{RawPath: path, Body: body, Headers: map[string]string{}} // path, body, no headers yet
        req.RequestContext.HTTP.Method = method                                                         // GET, POST, …
        if contentType != "" {                                                                          // only when the test sets one
                req.Headers["content-type"] = contentType // lowercase, as Lambda delivers it
        }
        return req // ready to send
}

// TestHandle runs one request per case and checks the status code.
func TestHandle(t *testing.T) {
        const js = "application/json" // the usual content type
        cases := []struct {
                name   string // what the case shows
                method string // HTTP method
                path   string // request path
                ctype  string // Content-Type header
                body   string // request body
                want   int    // expected status
        }{
                {"get board", "GET", "/api/scores", "", "", 200},
                {"unknown path", "GET", "/api/nope", "", "", 404},
                {"path outside api", "GET", "/", "", "", 404},
                {"wrong method", "DELETE", "/api/scores", "", "", 405},
                {"valid entry", "POST", "/api/scores", js, `{"initials":"ABC","score":1234}`, 201},
                {"charset is fine", "POST", "/api/scores", js + "; charset=utf-8", `{"initials":"ABC","score":0}`, 201},
                {"score at the cap", "POST", "/api/scores", js, `{"initials":"ZZZ","score":1000000}`, 201},
                {"no content type", "POST", "/api/scores", "", `{"initials":"ABC","score":1}`, 415},
                {"form content type", "POST", "/api/scores", "application/x-www-form-urlencoded", `initials=ABC`, 415},
                {"lowercase initials", "POST", "/api/scores", js, `{"initials":"abc","score":1}`, 400},
                {"two letters", "POST", "/api/scores", js, `{"initials":"AB","score":1}`, 400},
                {"four letters", "POST", "/api/scores", js, `{"initials":"ABCD","score":1}`, 400},
                {"digit", "POST", "/api/scores", js, `{"initials":"AB1","score":1}`, 400},
                {"non-ASCII letter", "POST", "/api/scores", js, `{"initials":"ÄBC","score":1}`, 400},
                {"negative score", "POST", "/api/scores", js, `{"initials":"ABC","score":-1}`, 400},
                {"over the cap", "POST", "/api/scores", js, `{"initials":"ABC","score":1000001}`, 400},
                {"fractional score", "POST", "/api/scores", js, `{"initials":"ABC","score":1.5}`, 400},
                {"score as text", "POST", "/api/scores", js, `{"initials":"ABC","score":"7"}`, 400},
                {"huge number", "POST", "/api/scores", js, `{"initials":"ABC","score":99999999999999999999}`, 400},
                {"missing score", "POST", "/api/scores", js, `{"initials":"ABC"}`, 400},
                {"missing initials", "POST", "/api/scores", js, `{"score":1}`, 400},
                {"extra field", "POST", "/api/scores", js, `{"initials":"ABC","score":1,"ip":"1.2.3.4"}`, 400},
                {"two objects", "POST", "/api/scores", js, `{"initials":"ABC","score":1}{"initials":"ABC","score":2}`, 400},
                {"trailing brace", "POST", "/api/scores", js, `{"initials":"ABC","score":1}}`, 400},
                {"not JSON", "POST", "/api/scores", js, `hello`, 400},
                {"empty body", "POST", "/api/scores", js, ``, 400},
                {"array", "POST", "/api/scores", js, `[{"initials":"ABC","score":1}]`, 400},
                {"too large", "POST", "/api/scores", js, `{"initials":"ABC","score":1,"x":"` + strings.Repeat("a", 1100) + `"}`, 413},
        }
        for _, c := range cases { // each case
                t.Run(c.name, func(t *testing.T) { // a named sub-test, so failures say which case
                        a := &app{scores: &fakeStore{}, maxScore: 1000000}                                      // fresh app per case
                        resp, err := a.handle(context.Background(), request(c.method, c.path, c.ctype, c.body)) // send the request
                        if err != nil {                                                                         // the handler must never return a Lambda error
                                t.Fatalf("handler error: %v", err) // fail
                        }
                        if resp.StatusCode != c.want { // wrong status
                                t.Fatalf("status %d, want %d (body %s)", resp.StatusCode, c.want, resp.Body) // fail with details
                        }
                        if resp.Headers["cache-control"] != "no-store" { // every response must be uncacheable
                                t.Fatalf("cache-control %q", resp.Headers["cache-control"]) // fail
                        }
                })
        }
}

// TestBase64Body: Lambda may deliver the body base64-encoded; it must still be read.
func TestBase64Body(t *testing.T) {
        f := &fakeStore{}                                                                                                                    // empty store
        a := &app{scores: f, maxScore: 10}                                                                                                   // cap 10
        req := request("POST", "/api/scores", "application/json", base64.StdEncoding.EncodeToString([]byte(`{"initials":"XYZ","score":7}`))) // encoded body
        req.IsBase64Encoded = true                                                                                                           // flagged as Lambda does
        resp, _ := a.handle(context.Background(), req)                                                                                       // send it
        if resp.StatusCode != 201 || len(f.added) != 1 || f.added[0] != (entry{"XYZ", 7}) {                                                  // stored exactly once, unchanged
                t.Fatalf("status %d, added %v", resp.StatusCode, f.added) // fail
        }
}

// TestGetEmptyBoard: no rows must give [] (an empty list), not null.
func TestGetEmptyBoard(t *testing.T) {
        a := &app{scores: &fakeStore{}, maxScore: 10}                                    // store with no rows
        resp, _ := a.handle(context.Background(), request("GET", "/api/scores", "", "")) // read the board
        if resp.Body != "[]" {                                                           // must be an empty array
                t.Fatalf("body %s, want []", resp.Body) // fail
        }
}

// TestStoreErrors: throttling gives 503, any other failure 500, and neither leaks details.
func TestStoreErrors(t *testing.T) {
        cases := []struct {
                err  error // what the store fails with
                want int   // expected status
        }{
                {&types.ProvisionedThroughputExceededException{}, 503}, // over the provisioned cap
                {errors.New("secret internal detail"), 500},            // anything else
        }
        for _, c := range cases { // each failure
                a := &app{scores: &fakeStore{err: c.err}, maxScore: 10} // failing store
                for _, req := range []events.LambdaFunctionURLRequest{  // both routes
                        request("GET", "/api/scores", "", ""),                                              // read
                        request("POST", "/api/scores", "application/json", `{"initials":"ABC","score":1}`), // write
                } {
                        resp, _ := a.handle(context.Background(), req) // send it
                        if resp.StatusCode != c.want {                 // wrong status
                                t.Fatalf("status %d, want %d", resp.StatusCode, c.want) // fail
                        }
                        if strings.Contains(resp.Body, "secret") { // the internal error text must not reach the client
                                t.Fatalf("error detail leaked: %s", resp.Body) // fail
                        }
                }
        }
}

// TestRankOrder: sorting rank keys in descending text order must give the scoreboard order.
func TestRankOrder(t *testing.T) {
        t0 := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC) // a fixed time
        keys := map[string]string{                           // rank key → which entry it is
                rankKey(5, t0, "a"):                  "5 early", // tie on 5, earlier
                rankKey(5, t0.Add(time.Minute), "b"): "5 later", // tie on 5, later
                rankKey(1000, t0, "c"):               "1000",    // highest
                rankKey(0, t0, "d"):                  "0",       // lowest
                rankKey(99, t0, "e"):                 "99",      // in between (shorter number, same padding)
        }
        sorted := make([]string, 0, len(keys)) // the keys alone
        for k := range keys {                  // collect them
                sorted = append(sorted, k) // add one
        }
        sort.Sort(sort.Reverse(sort.StringSlice(sorted)))         // descending, like ScanIndexForward=false
        want := []string{"1000", "99", "5 early", "5 later", "0"} // the arcade order
        for i, k := range sorted {                                // compare position by position
                if keys[k] != want[i] { // out of order
                        t.Fatalf("position %d is %s, want %s", i, keys[k], want[i]) // fail
                }
        }
}
