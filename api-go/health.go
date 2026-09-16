// Package handler is the entrypoint package for every Vercel Go serverless
// function in this directory. Each file listed explicitly as a `@vercel/go`
// build source in vercel.json becomes a route by exporting `Handler`:
//	api-go/health.go -> GET /api-go/health
// vercel.json lists route files individually rather than a recursive glob —
// Vercel's Go builder treats every matched *.go file as a function candidate
// requiring its own exported Handler, which breaks the moment a shared
// package (geo/) or a _test.go file is swept up by the glob too. Add new
// functions to vercel.json's `builds` array alongside this one.
package handler

import (
	"encoding/json"
	"net/http"
	"time"
)

// Handler is a liveness probe used to confirm the Go build + routing pipeline is
// wired up on Vercel. Real functions (geolocation check-in, cron reminders) land
// in sibling files.
func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"service": "office-hours-go",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}
