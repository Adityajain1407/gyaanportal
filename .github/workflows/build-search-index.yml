name: Build search index

on:
  push:
    branches: [main]
    paths:
      - '**.html'                      # only re-run when quiz files change
      - '.github/scripts/build-search-index.js'
  workflow_dispatch:                   # allow manual trigger from GitHub UI

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write                  # needed to commit search-index.json back

    steps:
      - name: Checkout repo
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build search-index.json
        run: node .github/scripts/build-search-index.js

      - name: Commit and push if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add search-index.json
          # Only commit if the index actually changed (avoids empty commits)
          git diff --cached --quiet || git commit -m "chore: rebuild search index [skip ci]"
          git push
