#!/usr/bin/env bash
# audit-docs.sh — Compare codebase reality against documentation.
# Run from workspace root (StoryRPG_New/) or storyrpg-prototype/.
# Output: structured text report for the Cursor agent to consume.

set -euo pipefail

# Resolve paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
PROTO="$WORKSPACE_ROOT/storyrpg-prototype"

if [ ! -d "$PROTO/src" ]; then
  echo "ERROR: Cannot find storyrpg-prototype/src. Run from workspace root." >&2
  exit 1
fi

echo "========================================"
echo "  StoryRPG Documentation Audit Report"
echo "  Generated: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo ""

# --- 1. Top-level workspace files ---
echo "## 1. Workspace Root Files"
echo "Actual:"
ls -1 "$WORKSPACE_ROOT" | grep -v node_modules | grep -v '.DS_Store' | sed 's/^/  /'
echo ""

# --- 2. docs/ directory listing ---
echo "## 2. docs/ Directory"
echo "Actual files:"
find "$WORKSPACE_ROOT/docs" -type f | sort | sed "s|$WORKSPACE_ROOT/||" | sed 's/^/  /'
echo ""

# --- 3. Package versions ---
echo "## 3. Key Package Versions (from package.json)"
if command -v node &>/dev/null; then
  node -e "
    const pkg = require('$PROTO/package.json');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const keys = ['expo', 'react', 'react-native', 'react-native-web', 'typescript', 'zustand', 'vitest'];
    keys.forEach(k => {
      if (deps[k]) console.log('  ' + k + ': ' + deps[k]);
    });
  "
else
  echo "  (node not available, skipping)"
fi
echo ""

# --- 4. Scripts ---
echo "## 4. package.json Scripts"
if command -v node &>/dev/null; then
  node -e "
    const pkg = require('$PROTO/package.json');
    Object.keys(pkg.scripts).sort().forEach(k => console.log('  ' + k + ': ' + pkg.scripts[k].substring(0, 80)));
  "
fi
echo ""

# --- 5. Screens ---
echo "## 5. Screens (src/screens/)"
find "$PROTO/src/screens" -name '*.tsx' -o -name '*.ts' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 6. Stores ---
echo "## 6. Stores (src/stores/)"
find "$PROTO/src/stores" -name '*.ts' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 7. Engine modules ---
echo "## 7. Engine (src/engine/)"
find "$PROTO/src/engine" -name '*.ts' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 8. AI Agents ---
echo "## 8. AI Agents (src/ai-agents/agents/)"
find "$PROTO/src/ai-agents/agents" -name '*.ts' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 9. Validators ---
echo "## 9. Validators (src/ai-agents/validators/)"
find "$PROTO/src/ai-agents/validators" -name '*.ts' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 10. Proxy routes ---
echo "## 10. Proxy Routes (proxy/)"
find "$PROTO/proxy" -name '*.js' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 11. Image team ---
echo "## 11. Image Team (src/ai-agents/agents/image-team/)"
find "$PROTO/src/ai-agents/agents/image-team" -name '*.ts' 2>/dev/null | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 12. Pipeline files ---
echo "## 12. Pipeline (src/ai-agents/pipeline/)"
find "$PROTO/src/ai-agents/pipeline" -name '*.ts' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 13. Services ---
echo "## 13. Services (src/ai-agents/services/ + src/services/)"
find "$PROTO/src/ai-agents/services" "$PROTO/src/services" -name '*.ts' 2>/dev/null | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 14. Config ---
echo "## 14. Config (src/config/)"
find "$PROTO/src/config" -name '*.ts' 2>/dev/null | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

# --- 15. Environment variables referenced in code ---
echo "## 15. Environment Variables Referenced in Code"
grep -roh 'process\.env\.\w\+' "$PROTO/src" "$PROTO/proxy-server.js" "$PROTO/proxy" 2>/dev/null | sort -u | sed 's/process\.env\./  /'
grep -roh 'EXPO_PUBLIC_\w\+' "$PROTO/src" 2>/dev/null | sort -u | sed 's/^/  /'
echo ""

# --- 16. Cursor skills ---
echo "## 16. Cursor Skills (.cursor/skills/)"
if [ -d "$PROTO/.cursor/skills" ]; then
  ls -1 "$PROTO/.cursor/skills/" | sed 's/^/  /'
fi
echo ""

# --- 17. Types exports ---
echo "## 17. Exported Types (src/types/index.ts — interfaces/types)"
grep -E '^export (interface|type) \w+' "$PROTO/src/types/index.ts" 2>/dev/null | sed 's/^.*export /  export /' | head -40
echo ""

# --- 18. tsconfig files ---
echo "## 18. TypeScript Configs"
find "$PROTO" -maxdepth 1 -name 'tsconfig*.json' | sort | sed "s|$PROTO/||" | sed 's/^/  /'
echo ""

echo "========================================"
echo "  END OF AUDIT REPORT"
echo "========================================"
