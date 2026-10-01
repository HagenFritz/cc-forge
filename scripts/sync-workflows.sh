#!/bin/bash
# Syncs .devin/workflows with the current skills in the repository

mkdir -p .devin/workflows
rm -f .devin/workflows/*.md

for skill_file in skills/*/SKILL.md; do
  skill=$(basename $(dirname "$skill_file"))
  # Reference-only skills (never invoked) get no Devin workflow
  if grep -qE '^user-invocable:[[:space:]]*"?false"?[[:space:]]*(#.*)?$' "$skill_file"; then
    echo "Skipped ${skill} (user-invocable: false)"
    continue
  fi
  # Extract description (single-line or a folded/literal block), remove quotes if present
  desc=$(awk '
    /^description:/ { v = $0; sub(/^description: */, "", v)
                      if (v ~ /^[>|][-+]?$/) { block = 1; v = ""; next }
                      print v; exit }
    block && /^[ \t]/ { line = $0; sub(/^[ \t]+/, "", line); v = (v == "" ? line : v " " line); next }
    block { print v; exit }
  ' "$skill_file" | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")
  
  cat <<DOC > ".devin/workflows/${skill}.md"
---
description: ${desc}
---
Invoke the \`${skill}\` skill using the skill tool. Follow its SKILL.md instructions from \`skills/${skill}/SKILL.md\` (if in the cc-forge repo) or \`~/.claude/skills/${skill}/SKILL.md\` exactly.
DOC

  echo "Generated .devin/workflows/${skill}.md"
done
