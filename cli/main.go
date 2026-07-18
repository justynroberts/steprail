// MIT License - Copyright (c) fintonlabs.com
//
// steprail — a small CLI for the steprail API. Stdlib only.
//
//	steprail flows                      list flows (active project filter optional)
//	steprail import <file.flow.json>    import a portable flow JSON
//	steprail run <flow name|id>         start a run and watch it finish
//	steprail runs <flow name|id>        recent runs for a flow
//
// Config via environment:
//
//	STEPRAIL_URL     server base URL   (default http://oracle.local:8452)
//	STEPRAIL_TOKEN   API access token  (sent as x-api-token when set)
//	STEPRAIL_PROJECT project id        (default "default")
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

var (
	baseURL = strings.TrimRight(env("STEPRAIL_URL", "http://oracle.local:8452"), "/")
	token   = env("STEPRAIL_TOKEN", "")
	project = env("STEPRAIL_PROJECT", "default")
)

func api(method, path string, body any) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("x-api-token", token)
	}
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("cannot reach %s — is the server running? (%v)", baseURL, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &e) == nil && e.Error != "" {
			return nil, fmt.Errorf("%s", e.Error)
		}
		return nil, fmt.Errorf("server answered %d", res.StatusCode)
	}
	return raw, nil
}

type flow struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	ProjectID string           `json:"projectId"`
	Active    *bool            `json:"active"`
	Steps     []map[string]any `json:"steps"`
	UpdatedAt int64            `json:"updatedAt"`
}

func fetchFlows() ([]flow, error) {
	raw, err := api("GET", "/api/flows", nil)
	if err != nil {
		return nil, err
	}
	var flows []flow
	if err := json.Unmarshal(raw, &flows); err != nil {
		return nil, err
	}
	return flows, nil
}

func findFlow(ref string) (*flow, error) {
	flows, err := fetchFlows()
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(ref)
	for i := range flows {
		if flows[i].ID == ref || strings.ToLower(flows[i].Name) == lower {
			return &flows[i], nil
		}
	}
	var partial []*flow
	for i := range flows {
		if strings.Contains(strings.ToLower(flows[i].Name), lower) {
			partial = append(partial, &flows[i])
		}
	}
	if len(partial) == 1 {
		return partial[0], nil
	}
	if len(partial) > 1 {
		names := make([]string, len(partial))
		for i, f := range partial {
			names[i] = fmt.Sprintf("%q", f.Name)
		}
		return nil, fmt.Errorf("%q matches %d flows: %s — be more specific", ref, len(partial), strings.Join(names, ", "))
	}
	return nil, fmt.Errorf("no flow named or matching %q", ref)
}

func cmdFlows() error {
	flows, err := fetchFlows()
	if err != nil {
		return err
	}
	sort.Slice(flows, func(a, b int) bool { return flows[a].UpdatedAt > flows[b].UpdatedAt })
	fmt.Printf("%-10s %-38s %-10s %-6s %s\n", "ID", "NAME", "PROJECT", "STEPS", "STATE")
	for _, f := range flows {
		state := "live"
		if f.Active != nil && !*f.Active {
			state = "off"
		}
		fmt.Printf("%-10s %-38s %-10s %-6d %s\n", f.ID, truncate(f.Name, 38), f.ProjectID, len(f.Steps), state)
	}
	return nil
}

func cmdImport(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var portable json.RawMessage
	if err := json.Unmarshal(raw, &portable); err != nil {
		return fmt.Errorf("%s is not valid JSON: %v", path, err)
	}
	res, err := api("POST", "/api/flows/import", map[string]any{"flow": portable, "projectId": project})
	if err != nil {
		return err
	}
	var out struct {
		ID       string   `json:"id"`
		Name     string   `json:"name"`
		Steps    int      `json:"steps"`
		Warnings []string `json:"warnings"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		return err
	}
	fmt.Printf("imported %q — %d steps, id %s, project %s\n", out.Name, out.Steps, out.ID, project)
	for _, w := range out.Warnings {
		fmt.Println("  warning:", w)
	}
	return nil
}

type runState struct {
	Running bool `json:"running"`
	Entries []struct {
		Name   string `json:"name"`
		Status string `json:"status"`
		Ms     int    `json:"ms"`
		Error  string `json:"error"`
	} `json:"entries"`
}

func cmdRun(ref string) error {
	f, err := findFlow(ref)
	if err != nil {
		return err
	}
	res, err := api("POST", "/api/runs", map[string]any{"flow": f, "speed": "instant"})
	if err != nil {
		return err
	}
	var started struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(res, &started); err != nil {
		return err
	}
	fmt.Printf("running %q (%s)\n", f.Name, started.RunID)

	seen := map[string]string{}
	for deadline := time.Now().Add(10 * time.Minute); time.Now().Before(deadline); {
		time.Sleep(400 * time.Millisecond)
		raw, err := api("GET", "/api/runs/"+started.RunID, nil)
		if err != nil {
			return err
		}
		var run runState
		if err := json.Unmarshal(raw, &run); err != nil {
			return err
		}
		for _, e := range run.Entries {
			if seen[e.Name] == e.Status {
				continue
			}
			seen[e.Name] = e.Status
			switch e.Status {
			case "success":
				fmt.Printf("  ✓ %-32s %dms\n", e.Name, e.Ms)
			case "error":
				fmt.Printf("  ✗ %-32s %s\n", e.Name, e.Error)
			case "skipped":
				fmt.Printf("  - %-32s skipped\n", e.Name)
			case "waiting":
				fmt.Printf("  … %-32s waiting for approval\n", e.Name)
			}
		}
		if !run.Running {
			failed := 0
			for _, e := range run.Entries {
				if e.Status == "error" {
					failed++
				}
			}
			if failed > 0 {
				return fmt.Errorf("run finished with %d failed step(s)", failed)
			}
			fmt.Println("run finished — all green")
			return nil
		}
	}
	return fmt.Errorf("gave up watching after 10 minutes — the run may still be going (see the Runs drawer)")
}

func cmdRuns(ref string) error {
	f, err := findFlow(ref)
	if err != nil {
		return err
	}
	raw, err := api("GET", "/api/runs?flowId="+f.ID, nil)
	if err != nil {
		return err
	}
	var runs []struct {
		ID        string `json:"id"`
		StartedAt int64  `json:"startedAt"`
		Running   bool   `json:"running"`
		OK        int    `json:"ok"`
		Failed    int    `json:"failed"`
		Trigger   string `json:"trigger"`
	}
	if err := json.Unmarshal(raw, &runs); err != nil {
		return err
	}
	fmt.Printf("%-14s %-22s %-9s %-4s %-6s\n", "RUN", "STARTED", "TRIGGER", "OK", "FAILED")
	for _, r := range runs {
		state := ""
		if r.Running {
			state = " (running)"
		}
		fmt.Printf("%-14s %-22s %-9s %-4d %-6d%s\n", r.ID, time.UnixMilli(r.StartedAt).Format("2006-01-02 15:04:05"), r.Trigger, r.OK, r.Failed, state)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func usage() {
	fmt.Fprintf(os.Stderr, `steprail — CLI for the steprail API (%s)

  steprail flows                      list flows
  steprail import <file.flow.json>    import a portable flow JSON
  steprail run <flow name|id>         start a run and watch it
  steprail runs <flow name|id>        recent runs for a flow

env: STEPRAIL_URL, STEPRAIL_TOKEN, STEPRAIL_PROJECT (current: %s)
`, baseURL, project)
	os.Exit(2)
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	var err error
	switch os.Args[1] {
	case "flows":
		err = cmdFlows()
	case "import":
		if len(os.Args) < 3 {
			usage()
		}
		err = cmdImport(os.Args[2])
	case "run":
		if len(os.Args) < 3 {
			usage()
		}
		err = cmdRun(strings.Join(os.Args[2:], " "))
	case "runs":
		if len(os.Args) < 3 {
			usage()
		}
		err = cmdRuns(strings.Join(os.Args[2:], " "))
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "steprail:", err)
		os.Exit(1)
	}
}
