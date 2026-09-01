# Product naming in UI copy

Grim Dawn uses **Cairn** as the name of its world. Cairn Codex copy must not use
that same word as shorthand for the application.

- Use **Cairn Codex** when introducing or formally naming the product, including
  the window title, welcome heading, operating-system dialogs, and accessibility
  labels that identify the application.
- Use **CC** as the compact subject or possessive when UI prose describes an
  application action, state, or owned resource: “CC rotates archive snapshots,”
  “CC could not read the archive,” and “CC’s data folder.”
- Use **Cairn** only for genuine Grim Dawn lore and content, such as the world,
  “Veil of the Cairn,” or “Cairn Hood.”
- Preserve code identifiers, executable names, file formats, and API names when
  changing them would alter a technical contract.

`npm run test:copy-policy` scans renderer-visible renderer, main-process, and
helper source. Standalone uses of “Cairn” fail unless their exact lore context is
explicitly allowed by the test.
