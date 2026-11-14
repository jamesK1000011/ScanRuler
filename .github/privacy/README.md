# Privacy and identity check

Runs in CI on every push and tag (`.github/workflows/privacy.yml`) and on
release artefacts before anything is published. A failure blocks the
release and is fixed, never waived.

- `check.py`: the check (plain Python 3.9+). `--git` scans tracked files and
  the whole history (authors, committers, messages, tags); a path scans a
  folder or file, zip-based files (.FCStd, .3mf, .mcpb, .whl) included.
- `terms.sha`: personal terms as salted scrypt hashes, so the list publishes
  nothing readable. Regenerate with `hash_terms.py <list kept elsewhere>`.
- `allow.txt`: regular expressions for findings that are provably not
  personal (licence boilerplate). Never a real name, path or address.
- `images.txt`: raster images that have been looked at, by SHA-256. A new or
  changed screenshot fails the check until it has been looked at and added.

`check.py`, `hash_terms.py`, `terms.sha` and `allow.txt` are the same in every
public repository of the project; keep them identical. `images.txt` is each
repository's own.
