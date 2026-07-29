-- Provider token renewal claims existed only to reconnect Gemini Live sockets.
-- Turn-based Voice sessions retain a single lease until the user exits.
drop table if exists private.voice_renewal_claims;
