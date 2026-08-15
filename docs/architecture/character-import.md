# Read-only character import

Cairn Codex discovers `player.gdc` under Documents, OneDrive Documents, and
Steam Cloud save roots. Import is deliberately lazy so loading the game database
and validating character saves does not delay app startup.

The parser reuses the MIT-derived GDIA cipher implementation already isolated
under `Gdia/Stash`. It reads the GDCX header, inventory/personal-stash framing,
and Block 8 character skills. The current supported data versions are 6, 7, and
8; skill-block versions 5 through 8 and inventory/stash versions through 11 are
validated. Every outer and nested checksum and declared block boundary must
match. The source file's size and modification timestamp are checked before and
after reading. On any unknown structure, checksum mismatch, concurrent save, or
truncation, the character is returned as unreadable and no partial profile is
created.

The implementation does not open character files for writing. Allocated skill
record paths are resolved through the user's installed ARZ and localization
archives. The renderer intersects those names with skills that actually have
catalogued item support, then creates or refreshes a character-backed shopping
profile. User-excluded skills survive later refreshes.

Format cross-checks used during implementation:

- GDIA (MIT) cipher and block primitives: <https://github.com/marius00/iagd>
- Current read-only v1.3 parser research, including Block 8 skill layout:
  <https://github.com/kotoba-lab/grimdawnrep/blob/master/src/grim_dawn_lab/gdc.py>
- Older header-only C# parser (MIT), useful as an independent GDCX header check:
  <https://github.com/ChrisElison/GDParser>

The local validation set on 2026-08-15 included 15 current and legacy local/
Steam Cloud saves. All passed structural validation; a current Hardcore Sanya
save resolved `Devouring Swarm` with a positive allocated rank.
