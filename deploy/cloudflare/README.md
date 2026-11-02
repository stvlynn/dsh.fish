# Cloudflare (zone `dsh.fish`)

Edge configuration that belongs to this repository, kept as data so a change
is reviewed and versioned like code. Zone is on the Free plan.

## Custom firewall rules

[`http_request_firewall_custom.json`](http_request_firewall_custom.json) is the
complete rule list of the zone's `http_request_firewall_custom` entrypoint
(ruleset "dsh.fish edge protection"). Updating a phase entrypoint replaces its
whole rule list, so the file is the whole truth, not a delta. Rules keep their
`ref`, so an update preserves an existing rule's identity instead of recreating
it.

```sh
# Validate against the API without persisting.
cf rulesets account-rulesets phases update http_request_firewall_custom \
  --zone dsh.fish --name "dsh.fish edge protection" \
  --rules @deploy/cloudflare/http_request_firewall_custom.json --validate-only

# Apply.
cf rulesets account-rulesets phases update http_request_firewall_custom \
  --zone dsh.fish --name "dsh.fish edge protection" \
  --rules @deploy/cloudflare/http_request_firewall_custom.json

# Inspect what is live.
cf rulesets account-rulesets phases get http_request_firewall_custom --zone dsh.fish
```

Roll back by applying the file from the previous commit, or set `enabled` to
`false` on one rule and apply. The reasoning for each rule, and for leaving Bot
Fight Mode off, is in
[`docs/operations/vps-deployment.md`](../../docs/operations/vps-deployment.md#edge-rules-cloudflare-zone-dshfish-free-plan).
