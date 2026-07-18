# steprail CLI

A single-binary Go client for the steprail API: list flows, import portable
flow JSON, start runs and watch them finish.

```
cd cli && go build -o steprail .

steprail flows                          # list flows across projects
steprail import ../samples/fleet-patrol.flow.json
steprail run "Fleet patrol"             # streams per-step results, exits non-zero on failure
steprail runs "Fleet patrol"            # recent run history
```

Configuration (environment):

| Var | Default | Meaning |
|---|---|---|
| `STEPRAIL_URL` | `http://oracle.local:8452` | server base URL |
| `STEPRAIL_TOKEN` | *(empty)* | sent as `x-api-token`; required once an access token is set in Setup |
| `STEPRAIL_PROJECT` | `default` | project imports land in |

`run` exits 0 only when every step succeeded — safe to use in scripts and CI.
