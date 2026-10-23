# shellcheck shell=bash
# A fingerprint of everything git would see in the working tree: status, the content of
# tracked changes, and the content of untracked (not ignored) files. check.sh compares it
# before and after, so a test or build that rewrites a file fails the check, even a file
# that already had uncommitted edits (git status alone shows " M" both times).
tree_fingerprint() {
  (
    cd "$ROOT"
    git status --porcelain=v1 -z
    git diff --binary HEAD
    git ls-files -z --others --exclude-standard | xargs -0 -r sha256sum --
  ) | sha256sum
}
