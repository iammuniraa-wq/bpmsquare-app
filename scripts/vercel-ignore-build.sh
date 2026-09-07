#!/usr/bin/env bash
# Vercel "Ignored Build Step". Exit 0 = skip this build, exit 1 = build normally.
#
# Wired into Vercel Project Settings -> Git -> Ignored Build Step as:
#   bash scripts/vercel-ignore-build.sh
#
# Why this exists: every push to every connected branch was triggering a full
# build, and Build CPU Minutes is the largest line item on the Vercel usage
# bill. Two branch-hygiene facts made that expensive: five branches besides
# main/develop stay open for days while a fix or pricing change is worked out
# (each push its own build), and a chunk of commits only touch PROJECT.md or
# docs/ -- content Vercel doesn't even serve.
#
# Rule 1 -- only main and develop get a live deployment per push. A feature/
# fix/pricing branch is reviewed locally (`next dev`) or in its PR diff; it
# doesn't need its own preview URL rebuilt on every commit. Merging to develop
# is what should trigger the next real build.
BRANCH="$VERCEL_GIT_COMMIT_REF"
if [[ "$BRANCH" != "main" && "$BRANCH" != "develop" ]]; then
  echo "Skipping build: branch '$BRANCH' is not main or develop."
  exit 0
fi

# Rule 2 -- skip when the push touches only docs (*.md, docs/**), even on
# main/develop. PROJECT.md's "migration applied" commits are the common case;
# none of it reaches the deployed app. Diff against the last deployed commit
# for this branch (not just HEAD^), so a multi-commit push where only the
# latest commit is docs-only doesn't skip a build a code commit earlier in
# the same push actually needs.
BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
CHANGED_FILES=$(git diff --name-only "$BASE_SHA" HEAD 2>/dev/null)
if [[ -n "$CHANGED_FILES" ]] && ! echo "$CHANGED_FILES" | grep -qvE '\.md$|^docs/'; then
  echo "Skipping build: only docs changed ($CHANGED_FILES)."
  exit 0
fi

echo "Proceeding with build for branch '$BRANCH'."
exit 1
