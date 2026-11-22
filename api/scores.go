// DynamoDB storage for the Pachinko scoreboard.
//
// Table footprintz-scores: partition key "board" (always "pachinko" for now) and sort
// key "rank", a string that sorts like the scoreboard. Reading the partition in
// descending order with a limit of 10 gives the top 10 in one small Query.
package main // same program as main.go

import (
	"context"     // the request's deadline
	"crypto/rand" // random IDs
	"fmt"         // builds the rank string
	"log"         // notes a failed place count in CloudWatch Logs
	"math"        // math.MaxInt64
	"strconv"     // numbers to text and back
	"time"        // the server time of each entry

	"github.com/aws/aws-sdk-go-v2/aws"                    // helpers for pointer fields
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"       // the DynamoDB client
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types" // DynamoDB value types
)

const board = "pachinko" // the only board; another game would get its own value

// dynamoScores is the real scoreStore.
type dynamoScores struct {
	db    *dynamodb.Client // DynamoDB client, made once per cold start
	table string           // the table name
}

// rankKey builds the sort key: score, then time reversed, then a random ID.
// Zero-padding to 19 digits (the length of the largest int64) makes text order match
// number order. In descending order the higher score comes first, and on a tie the
// earlier entry does, as on an arcade board. The ID keeps two entries from colliding.
func rankKey(score int64, at time.Time, id string) string {
	return fmt.Sprintf("%019d#%019d#%s", score, math.MaxInt64-at.UnixNano(), id) // e.g. 0000000000000001234#…#…
}

// top returns the n highest scores, highest first.
func (d *dynamoScores) top(ctx context.Context, n int32) ([]entry, error) {
	out, err := d.db.Query(ctx, &dynamodb.QueryInput{ // one Query, no Scan
		TableName:              aws.String(d.table),   // the scores table
		KeyConditionExpression: aws.String("#b = :b"), // only this board's rows
		ExpressionAttributeNames: map[string]string{ // placeholders, so no name clashes with DynamoDB's reserved words
			"#b": "board",    // partition key
			"#i": "initials", // returned field
			"#s": "score",    // returned field
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{ // the value for :b
			":b": &types.AttributeValueMemberS{Value: board}, // "pachinko"
		},
		ProjectionExpression: aws.String("#i, #s"), // read back only initials and score
		ScanIndexForward:     aws.Bool(false),      // descending: highest rank first
		Limit:                aws.Int32(n),         // stop after n rows
	})
	if err != nil { // throttled, permissions, network
		return nil, err // the handler logs it and answers 503/500
	}
	list := make([]entry, 0, len(out.Items)) // room for every row returned
	for _, item := range out.Items {         // each row
		if e, ok := itemToEntry(item); ok { // a well-formed row
			list = append(list, e) // keep it
		} // a malformed row is skipped rather than failing the whole board
	}
	return list, nil // the top scores
}

// add stores one entry with the server's time and returns its place on the board
// (1 = top). The place is 0 when it couldn't be counted; the entry is stored either way.
func (d *dynamoScores) add(ctx context.Context, e entry) (int, error) {
	now := time.Now().UTC()                             // the server's clock, not the client's
	key := rankKey(e.Score, now, rand.Text())           // sort key; rand.Text: 26 random characters
	_, err := d.db.PutItem(ctx, &dynamodb.PutItemInput{ // write one row
		TableName: aws.String(d.table), // the scores table
		Item: map[string]types.AttributeValue{ // the row's fields
			"board":    &types.AttributeValueMemberS{Value: board},                          // partition key
			"rank":     &types.AttributeValueMemberS{Value: key},                            // sort key built above
			"initials": &types.AttributeValueMemberS{Value: e.Initials},                     // e.g. "ABC"
			"score":    &types.AttributeValueMemberN{Value: strconv.FormatInt(e.Score, 10)}, // stored as a DynamoDB number
			"created":  &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},       // e.g. 2026-11-20T21:30:00Z
		}, // nothing else: no IP, user agent or cookie
	})
	if err != nil { // not stored
		return 0, err // the handler logs it and answers 503/500
	}
	above, err := d.countAbove(ctx, key) // how many entries rank higher
	if err != nil {                      // throttled or out of time: the entry is stored, only the place is missing
		log.Printf("rank count: %v", err) // note it in the logs
		return 0, nil                     // 0 = place unknown; still a success
	}
	return above + 1, nil // one below everyone above it
}

// countAbove counts the board's entries whose sort key is higher than key, i.e. the
// entries ranked above it. Select COUNT returns only numbers, no rows; the paginator
// follows DynamoDB's 1 MB pages. Each page still costs reads, so on a big board a low
// score costs more to place than a high one.
func (d *dynamoScores) countAbove(ctx context.Context, key string) (int, error) {
	p := dynamodb.NewQueryPaginator(d.db, &dynamodb.QueryInput{ // a Query that may span pages
		TableName:              aws.String(d.table),               // the scores table
		KeyConditionExpression: aws.String("#b = :b AND #r > :k"), // this board, sort key above the new entry's
		ExpressionAttributeNames: map[string]string{ // placeholders for the key names
			"#b": "board", // partition key
			"#r": "rank",  // sort key
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{ // the values compared against
			":b": &types.AttributeValueMemberS{Value: board}, // "pachinko"
			":k": &types.AttributeValueMemberS{Value: key},   // the new entry's sort key
		},
		Select: types.SelectCount, // return the number of matches, not the rows
	})
	n := 0                 // running total
	for p.HasMorePages() { // one page per loop, until DynamoDB says there are no more
		out, err := p.NextPage(ctx) // read the next page
		if err != nil {             // throttled, or the request's time ran out
			return 0, err // give up; the caller reports "place unknown"
		}
		n += int(out.Count) // add this page's matches
	}
	return n, nil // entries ranked above
}

// itemToEntry reads initials and score from one row; false if either is missing or wrong.
func itemToEntry(item map[string]types.AttributeValue) (entry, bool) {
	ini, ok := item["initials"].(*types.AttributeValueMemberS) // must be a string
	if !ok {                                                   // missing or another type
		return entry{}, false // skip
	}
	sc, ok := item["score"].(*types.AttributeValueMemberN) // must be a number
	if !ok {                                               // missing or another type
		return entry{}, false // skip
	}
	n, err := strconv.ParseInt(sc.Value, 10, 64) // DynamoDB numbers arrive as text
	if err != nil {                              // not a whole number
		return entry{}, false // skip
	}
	return entry{Initials: ini.Value, Score: n}, true // a good row
}
