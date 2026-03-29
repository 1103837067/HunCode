# VS Code Extension E2E Smoke Checklist

## Minimum non-blank smoke path

A smoke run is successful only if all of the following are true:

- [ ] The `Pi` Sidebar opens
- [ ] The page is not blank
- [ ] The debug banner renders
- [ ] The Header renders
- [ ] Either Chat or Settings content renders
- [ ] Chat ↔ Settings navigation works
- [ ] The `Pi` output channel shows extension/backend/rpc logs

## Next-level main flow

- [ ] Model information is visible
- [ ] Settings page shows connection/workspace/context sections
- [ ] Sending a prompt inserts user + assistant placeholders
- [ ] Tool/status updates appear when backend responds
