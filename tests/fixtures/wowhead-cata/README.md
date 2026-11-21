`weapon.xml`, `armor.xml`, `ring.xml` and `trinket.xml` are hand-authored parser/HTTP/browser fixtures for the observed XML + JSON-fragment format. IDs and statistics are synthetic and are NOT captured Wowhead item data. Live Wowhead 19019 is tested separately and must not be claimed successful from these fixtures.

`19019.xml` is different: the actual Wowhead **Cataclysm** response pasted by the
user from their Windows browser on 2026-11-21. It reproduces the six unknown-field
failure exactly on the previous parser. Only the XML was retained; the browser's
"no style information" banner is not XML. This is a fixed user-supplied capture,
not a successful HTTP fetch by the cloud runner, and not fabricated item data.
SHA256 of this stored copy (not the unobserved original HTTP bytes):
`3db44df95a3e21f2dfbe081174fd02e557e97d3a1bffed2e13d60f9e877d516b`.
The mutation tests explicitly alter a copy; the regression itself uses this file
unchanged. `jsonUse.natres=-25` is a proc effect, never equipment resistance.
The tooltip's extra nature damage and resistance lines are not numeric equipment
fields in this response and remain description-only, requiring manual setup.
