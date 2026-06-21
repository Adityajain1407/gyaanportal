#!/usr/bin/env python3
"""
Patches already-published quiz HTML files to add Firebase anonymous
authentication — required now that the Firebase rules have been
tightened to "auth != null". Without this, older quiz files (generated
before this fix) can't read/write saved questions, progress, or the
leaderboard anymore.

This script is SAFE TO RUN MULTIPLE TIMES — it checks for the patch
before applying it, so already-patched or newly-generated files (which
already have this code from the updated master_prompt.md) are left
untouched and reported as "already patched", not double-patched.

USAGE:
    1. Clone your repo locally (or download all your quiz .html files
       into one folder).
    2. Place this script in that same folder, or pass the folder path
       as an argument:
           python3 patch_quizzes.py /path/to/your/repo
       (defaults to the current folder if no path is given)
    3. Run it. It edits matching files in place.
    4. Review the summary, commit, and push.

It deliberately does NOT touch index.html (the portal) — that file was
already patched directly as part of the original fix.
"""
import sys
import re
from pathlib import Path

AUTH_SCRIPT_TAG = '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>'

OLD_SCRIPT_BLOCK = '''<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>'''
NEW_SCRIPT_BLOCK = '''<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>
    ''' + AUTH_SCRIPT_TAG

# Matches "showWelcome();" followed by "initQuizFMListener();" with any
# amount of whitespace/indentation between/around them, since individual
# quiz files may have been hand-edited slightly differently over time.
BOOTSTRAP_PATTERN = re.compile(
    r'[ \t]*showWelcome\(\);\s*\n[ \t]*initQuizFMListener\(\);',
)

def make_bootstrap_replacement(matched_text, indent):
    return (
        f'{indent}// Sign in anonymously before the bootstrap below touches the database\n'
        f'{indent}(async () => {{\n'
        f'{indent}    try {{ await firebase.auth().signInAnonymously(); }} catch(e) {{ console.warn(\'Anonymous auth failed:\', e); }}\n'
        f'{indent}    showWelcome();\n'
        f'{indent}    initQuizFMListener();\n'
        f'{indent}}})();'
    )

def patch_file(path: Path):
    text = path.read_text(encoding='utf-8')
    original = text

    if AUTH_SCRIPT_TAG in text and 'signInAnonymously' in text:
        return 'already_patched'

    # 1) Add the auth SDK script tag
    if OLD_SCRIPT_BLOCK in text:
        text = text.replace(OLD_SCRIPT_BLOCK, NEW_SCRIPT_BLOCK, 1)
    elif AUTH_SCRIPT_TAG not in text:
        # Script block didn't match exactly (whitespace differences) —
        # fall back to inserting right after the database script tag specifically.
        db_tag = '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>'
        if db_tag in text:
            text = text.replace(db_tag, db_tag + '\n    ' + AUTH_SCRIPT_TAG, 1)
        else:
            return 'no_match_script_tag'

    # 2) Gate the bootstrap call on anonymous sign-in
    m = BOOTSTRAP_PATTERN.search(text)
    if not m:
        if 'signInAnonymously' in text:
            # Script tag got added above but bootstrap pattern wasn't found —
            # save what we have so the script tag fix isn't lost, but flag it.
            path.write_text(text, encoding='utf-8')
            return 'no_match_bootstrap'
        return 'no_match_bootstrap'

    matched_text = m.group(0)
    # Recover the indentation used on the showWelcome() line specifically
    indent_match = re.match(r'[ \t]*', matched_text)
    indent = indent_match.group(0) if indent_match else '    '
    replacement = make_bootstrap_replacement(matched_text, indent)
    text = text[:m.start()] + replacement + text[m.end():]

    if text == original:
        return 'no_change'

    path.write_text(text, encoding='utf-8')
    return 'patched'

def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    html_files = sorted(folder.glob('*.html'))
    # Skip the portal itself — it's already patched separately
    html_files = [f for f in html_files if f.name.lower() != 'index.html']

    if not html_files:
        print(f'No .html files found in {folder.resolve()} (excluding index.html).')
        return

    results = {}
    for f in html_files:
        try:
            status = patch_file(f)
        except Exception as e:
            status = f'error: {e}'
        results.setdefault(status, []).append(f.name)

    print(f'\nScanned {len(html_files)} file(s) in {folder.resolve()}\n')
    for status in ['patched', 'already_patched', 'no_match_script_tag', 'no_match_bootstrap', 'no_change']:
        if status in results:
            label = {
                'patched': '✅ Patched successfully',
                'already_patched': '⏭️  Already patched (skipped, no changes needed)',
                'no_match_script_tag': '⚠️  Could not find Firebase script tags — needs manual fix',
                'no_match_bootstrap': '⚠️  Could not find showWelcome()/initQuizFMListener() — needs manual fix',
                'no_change': 'ℹ️  No changes were necessary',
            }[status]
            print(f'{label}: {len(results[status])} file(s)')
            for name in results[status]:
                print(f'    - {name}')
    for status, names in results.items():
        if status.startswith('error:'):
            print(f'❌ {status}: {", ".join(names)}')

    print('\nNext steps: review the changes (git diff), then commit and push.')

if __name__ == '__main__':
    main()
