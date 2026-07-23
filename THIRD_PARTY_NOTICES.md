# Third-party notices

## KJV 1769 verse corpus

This project uses the `kjv` npm package (`1.0.0`) and its
`json/verses-1769.json` data file for private, server-side Scripture retrieval.
The corpus is the King James Version 1769 and is released into the public
domain by its upstream project:

<https://github.com/farskipper/kjv>

The corpus is not included in the browser or native application bundle. The
server returns only the passages relevant to an authenticated user's question.
