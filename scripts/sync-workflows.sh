#!/bin/bash
# Syncs .devin/workflows with the current skills in the repository

mkdir -p .devin/workflows
rm -f .devin/workflows/*.md

for skill_file in skills/*/SKILL.md; do
  skill=$(basename $(dirname "$skill_file"))
  # Reference-only skills (never invoked) get no Devin workflow
  if grep -q "^user-invocable: false" "$skill_file"; then
    echo "Skipped ${skill} (user-invocable: false)"
    continue
  fi
  # Extract description, remove quotes if present
  desc=$(grep -m 1 "^description:" "$skill_file" | sed 's/^description: *//' | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")
  
  cat <<DOC > ".devin/workflows/${skill}.md"
---
description: ${desc}
---
Invoke the \`${skill}\` skill using the skill tool. Follow its SKILL.md instructions from \`skills/${skill}/SKILL.md\` (if in the cc-forge repo) or \`~/.claude/skills/${skill}/SKILL.md\` exactly.
DOC

  echo "Generated .devin/workflows/${skill}.md"
done
