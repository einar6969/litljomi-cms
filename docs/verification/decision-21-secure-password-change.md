# Decision 21: secure password change, local verification

- Date: 2026-11-02. Commit 27e3d3b (`[auth.email] secure_password_change = true`, with a config regression test).
- Local Supabase stack (Supabase CLI 2.121.0, GoTrue v2.197.0). Keys and tokens are redacted below; the database was reset afterwards.
- Einar's decision (plan decision 21): "I approve enabling `secure_password_change`, subject to verifying the exact configuration and behavior locally. Document its limitations accurately; it is additional protection, not a substitute for the passwordless Auth hook."

## Observed behaviour
- A session less than 24 hours old changes the password without any reauthentication (200).
- A session older than 24 hours (its `auth.sessions.created_at` moved back 25 hours in the local database) is refused without a nonce: HTTP 400 `reauthentication_needed`, "Password update requires reauthentication". `GET /auth/v1/reauthenticate` emails a 6-digit code; the update with that code as `nonce` succeeds (200); a repeat without a nonce is refused again; a wrong nonce gets 422.
- A user with TOTP enrolled on an `aal1` session is refused (HTTP 401 `insufficient_aal`); on an `aal2` session the change succeeds.
- Every password change, with or without a nonce, revoked the user's other sessions (their refresh: 400 `refresh_token_not_found`); the session that made the change stayed valid.
- Magic link, one-time code and refresh still work.
- The Supabase CLI reference describes the setting as requiring "the user's current password"; that is not what this version does.

## What it is and is not
Additional protection only: it makes a stolen session older than 24 hours unable to set a password without the emailed code. It does not stop a recent session from setting one, does not require fresh email verification for every change, and does not stop a password from signing in — the passwordless Auth hook (decision 18, Task 4) does that. Until Task 4 the local stack has no hook, so a password set locally does sign in.

## Request and response log (redacted)
```

### setup: create editor
POST /auth/v1/admin/users  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"email":"editor1@s3.local","email_confirm":true}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.999950954Z","phone":"","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755165Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.000147Z","is_anonymous":false}

### session A (magic link): admin generate_link
POST /auth/v1/admin/generate_link  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"type":"magiclink","email":"editor1@s3.local"}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:47.015379558Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.015718Z","is_anonymous":false,"action_link":"http://127.0.0.1:54321/auth/v1/verify?token=f1957b0df9b0fd6144840b3790cc382b3239d1e67d6091bbb5862ac2&type=magiclink&redirect_to=http://localhost:3000","email_otp":"580426","hashed_token":"<redacted>","verification_type":"magiclink","redirect_to":"http://localhost:3000"}

### session A (magic link): verify magiclink token_hash
POST /auth/v1/verify  [apikey: <KEY>]
body: {"type":"magiclink","token_hash":"<hash>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585627,"refresh_token":"<redacted>","user":{"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:47.015379Z","last_sign_in_at":"2026-11-02T01:13:47.02282334Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.027063Z","is_anonymous":false}}

### session B (one-time code): admin generate_link
POST /auth/v1/admin/generate_link  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"type":"magiclink","email":"editor1@s3.local"}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:47.033174826Z","last_sign_in_at":"2026-11-02T01:13:47.022823Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.033493Z","is_anonymous":false,"action_link":"http://127.0.0.1:54321/auth/v1/verify?token=4e916566d65597e0e15bd094a03df2d0537eb579b0c6ae8edd7d78c2&type=magiclink&redirect_to=http://localhost:3000","email_otp":"420862","hashed_token":"<redacted>","verification_type":"magiclink","redirect_to":"http://localhost:3000"}

### session B (one-time code): verify one-time code (type email)
POST /auth/v1/verify  [apikey: <KEY>]
body: {"type":"email","email":"editor1@s3.local","token":"<code>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585627,"refresh_token":"<redacted>","user":{"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:47.033174Z","last_sign_in_at":"2026-11-02T01:13:47.037659487Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.037967Z","is_anonymous":false}}
A aal=aal1, B aal=aal1

### FRESH session A: password update without nonce
PUT /auth/v1/user  [apikey: <KEY>; Authorization: Bearer <A access>]
body: {"password":"<pw>"}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","last_sign_in_at":"2026-11-02T01:13:47.037659Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.135358Z","is_anonymous":false}

### session B refresh after A changed password
POST /auth/v1/token?grant_type=refresh_token  [apikey: <KEY>]
body: {"refresh_token":"<rt>"}
-> 400 {"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}

### session A refresh after password update
POST /auth/v1/token?grant_type=refresh_token  [apikey: <KEY>]
body: {"refresh_token":"<rt>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585627,"refresh_token":"<redacted>","user":{"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","last_sign_in_at":"2026-11-02T01:13:47.037659Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.14622Z","is_anonymous":false}}

### password sign-in (grant_type=password) with the new password (hook not present locally)
POST /auth/v1/token?grant_type=password  [apikey: <KEY>]
body: {"email":"editor1@s3.local","password":"<pw>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585627,"refresh_token":"<redacted>","user":{"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","last_sign_in_at":"2026-11-02T01:13:47.201565477Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:47.202019Z","is_anonymous":false},"weak_password":null}

### session C (created after the fresh change, to test revocation on the nonce change): admin generate_link
POST /auth/v1/admin/generate_link  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"type":"magiclink","email":"editor1@s3.local"}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:55.345498797Z","last_sign_in_at":"2026-11-02T01:13:47.201565Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:55.345955Z","is_anonymous":false,"action_link":"http://127.0.0.1:54321/auth/v1/verify?token=828f3c8575f22d80ee53b11b85d43ea5f10c33f12208eefed2c429cf&type=magiclink&redirect_to=http://localhost:3000","email_otp":"976021","hashed_token":"<redacted>","verification_type":"magiclink","redirect_to":"http://localhost:3000"}

### session C (created after the fresh change, to test revocation on the nonce change): verify magiclink token_hash
POST /auth/v1/verify  [apikey: <KEY>]
body: {"type":"magiclink","token_hash":"<hash>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585635,"refresh_token":"<redacted>","user":{"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:55.345498Z","last_sign_in_at":"2026-11-02T01:13:55.357807781Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:55.358673Z","is_anonymous":false}}

### AGED session A: password update without nonce
PUT /auth/v1/user  [apikey: <KEY>; Authorization: Bearer <A access>]
body: {"password":"<pw>"}
-> 400 {"code":400,"error_code":"reauthentication_needed","msg":"Password update requires reauthentication"}

### AGED session A: password update with a bogus nonce
PUT /auth/v1/user  [apikey: <KEY>; Authorization: Bearer <A access>]
body: {"password":"<pw>","nonce":"<nonce>"}
-> 422 {"code":422,"error_code":"reauthentication_not_valid","msg":"Nonce has expired or is invalid"}

### AGED session A: reauthenticate
GET /auth/v1/reauthenticate  [apikey: <KEY>; Authorization: Bearer <A access>]
body: undefined
-> 200 {}

mail: To=editor1@s3.local Subject="627424 is your verification code"
nonce found in mail: yes (6 digits)

### AGED session A: password update WITH emailed nonce
PUT /auth/v1/user  [apikey: <KEY>; Authorization: Bearer <A access>]
body: {"password":"<pw>","nonce":"<nonce>"}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","last_sign_in_at":"2026-11-02T01:13:55.357807Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:56.284493Z","is_anonymous":false}

### AGED session A: repeat update without nonce (nonce consumed; session still aged)
PUT /auth/v1/user  [apikey: <KEY>; Authorization: Bearer <A access>]
body: {"password":"<pw>"}
-> 400 {"code":400,"error_code":"reauthentication_needed","msg":"Password update requires reauthentication"}

### session B refresh after A changed password with nonce
POST /auth/v1/token?grant_type=refresh_token  [apikey: <KEY>]
body: {"refresh_token":"<rt>"}
-> 400 {"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}

### post-change magic link sign-in: admin generate_link
POST /auth/v1/admin/generate_link  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"type":"magiclink","email":"editor1@s3.local"}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:56.297399151Z","last_sign_in_at":"2026-11-02T01:13:55.357807Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:56.297635Z","is_anonymous":false,"action_link":"http://127.0.0.1:54321/auth/v1/verify?token=eddc879d748b0fc3e959a746e310f8bf94a23567c671a681c18803a1&type=magiclink&redirect_to=http://localhost:3000","email_otp":"257030","hashed_token":"<redacted>","verification_type":"magiclink","redirect_to":"http://localhost:3000"}

### post-change magic link sign-in: verify magiclink token_hash
POST /auth/v1/verify  [apikey: <KEY>]
body: {"type":"magiclink","token_hash":"<hash>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585636,"refresh_token":"<redacted>","user":{"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:56.297399Z","last_sign_in_at":"2026-11-02T01:13:56.302502603Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:56.30293Z","is_anonymous":false}}

### post-change one-time code sign-in: admin generate_link
POST /auth/v1/admin/generate_link  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"type":"magiclink","email":"editor1@s3.local"}
-> 200 {"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:56.307416721Z","last_sign_in_at":"2026-11-02T01:13:56.302502Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:56.307652Z","is_anonymous":false,"action_link":"http://127.0.0.1:54321/auth/v1/verify?token=295b21ead6662528402eccfe828273b0faa007b3fa0cbf2c45074c92&type=magiclink&redirect_to=http://localhost:3000","email_otp":"902606","hashed_token":"<redacted>","verification_type":"magiclink","redirect_to":"http://localhost:3000"}

### post-change one-time code sign-in: verify one-time code (type email)
POST /auth/v1/verify  [apikey: <KEY>]
body: {"type":"email","email":"editor1@s3.local","token":"<code>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585636,"refresh_token":"<redacted>","user":{"id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","aud":"authenticated","role":"authenticated","email":"editor1@s3.local","email_confirmed_at":"2026-11-02T01:13:46.99995Z","phone":"","confirmed_at":"2026-11-02T01:13:46.99995Z","recovery_sent_at":"2026-11-02T01:13:56.307416Z","last_sign_in_at":"2026-11-02T01:13:56.311623174Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"025124c0-1211-44ac-bba2-702d9d1741ff","id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","user_id":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9","identity_data":{"email":"editor1@s3.local","email_verified":false,"phone_verified":false,"sub":"08cfba2b-3772-4bab-9b3c-8bb359e1ebf9"},"provider":"email","last_sign_in_at":"2026-11-02T01:13:46.997755Z","created_at":"2026-11-02T01:13:46.997772Z","updated_at":"2026-11-02T01:13:46.997772Z","email":"editor1@s3.local"}],"created_at":"2026-11-02T01:13:46.993613Z","updated_at":"2026-11-02T01:13:56.311942Z","is_anonymous":false}}

### MFA setup: create editor
POST /auth/v1/admin/users  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"email":"editor2@s3.local","email_confirm":true}
-> 200 {"id":"63930cb6-46a0-4faf-9692-bbe7794a5401","aud":"authenticated","role":"authenticated","email":"editor2@s3.local","email_confirmed_at":"2026-11-02T01:14:01.069679821Z","phone":"","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"23df17a7-6308-4c52-a8c3-e230093c09db","id":"63930cb6-46a0-4faf-9692-bbe7794a5401","user_id":"63930cb6-46a0-4faf-9692-bbe7794a5401","identity_data":{"email":"editor2@s3.local","email_verified":false,"phone_verified":false,"sub":"63930cb6-46a0-4faf-9692-bbe7794a5401"},"provider":"email","last_sign_in_at":"2026-11-02T01:14:01.069093989Z","created_at":"2026-11-02T01:14:01.06912Z","updated_at":"2026-11-02T01:14:01.06912Z","email":"editor2@s3.local"}],"created_at":"2026-11-02T01:14:01.068579Z","updated_at":"2026-11-02T01:14:01.069866Z","is_anonymous":false}

### MFA user session (aal1): admin generate_link
POST /auth/v1/admin/generate_link  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"type":"magiclink","email":"editor2@s3.local"}
-> 200 {"id":"63930cb6-46a0-4faf-9692-bbe7794a5401","aud":"authenticated","role":"authenticated","email":"editor2@s3.local","email_confirmed_at":"2026-11-02T01:14:01.069679Z","phone":"","confirmed_at":"2026-11-02T01:14:01.069679Z","recovery_sent_at":"2026-11-02T01:14:01.084922259Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"23df17a7-6308-4c52-a8c3-e230093c09db","id":"63930cb6-46a0-4faf-9692-bbe7794a5401","user_id":"63930cb6-46a0-4faf-9692-bbe7794a5401","identity_data":{"email":"editor2@s3.local","email_verified":false,"phone_verified":false,"sub":"63930cb6-46a0-4faf-9692-bbe7794a5401"},"provider":"email","last_sign_in_at":"2026-11-02T01:14:01.069093Z","created_at":"2026-11-02T01:14:01.06912Z","updated_at":"2026-11-02T01:14:01.06912Z","email":"editor2@s3.local"}],"created_at":"2026-11-02T01:14:01.068579Z","updated_at":"2026-11-02T01:14:01.085338Z","is_anonymous":false,"action_link":"http://127.0.0.1:54321/auth/v1/verify?token=2058f03bd2a0c7fae1fe671ad1560f5cf850282db05028e414fd2a8b&type=magiclink&redirect_to=http://localhost:3000","email_otp":"640633","hashed_token":"<redacted>","verification_type":"magiclink","redirect_to":"http://localhost:3000"}

### MFA user session (aal1): verify magiclink token_hash
POST /auth/v1/verify  [apikey: <KEY>]
body: {"type":"magiclink","token_hash":"<hash>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585641,"refresh_token":"<redacted>","user":{"id":"63930cb6-46a0-4faf-9692-bbe7794a5401","aud":"authenticated","role":"authenticated","email":"editor2@s3.local","email_confirmed_at":"2026-11-02T01:14:01.069679Z","phone":"","confirmed_at":"2026-11-02T01:14:01.069679Z","recovery_sent_at":"2026-11-02T01:14:01.084922Z","last_sign_in_at":"2026-11-02T01:14:01.090423544Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"identities":[{"identity_id":"23df17a7-6308-4c52-a8c3-e230093c09db","id":"63930cb6-46a0-4faf-9692-bbe7794a5401","user_id":"63930cb6-46a0-4faf-9692-bbe7794a5401","identity_data":{"email":"editor2@s3.local","email_verified":false,"phone_verified":false,"sub":"63930cb6-46a0-4faf-9692-bbe7794a5401"},"provider":"email","last_sign_in_at":"2026-11-02T01:14:01.069093Z","created_at":"2026-11-02T01:14:01.06912Z","updated_at":"2026-11-02T01:14:01.06912Z","email":"editor2@s3.local"}],"created_at":"2026-11-02T01:14:01.068579Z","updated_at":"2026-11-02T01:14:01.090757Z","is_anonymous":false}}

### MFA enroll TOTP
POST /auth/v1/factors  [apikey: <KEY>; Authorization: Bearer <S access>]
body: {"factor_type":"totp","friendly_name":"s3"}
-> 200 {"id":"4560333f-a1fb-4b75-847d-6c1f98ba79e6","type":"totp","friendly_name":"s3","totp":{"qr_code":"<redacted>","secret":"<redacted>","uri":"<redacted>"}}

### MFA challenge
POST /auth/v1/factors/4560333f-a1fb-4b75-847d-6c1f98ba79e6/challenge  [apikey: <KEY>; Authorization: Bearer <S access>]
body: {}
-> 200 {"id":"21a5ca50-7fff-4228-bf6d-f9befd4095ae","type":"totp","expires_at":1793582341}

### MFA verify (aal2)
POST /auth/v1/factors/4560333f-a1fb-4b75-847d-6c1f98ba79e6/verify  [apikey: <KEY>; Authorization: Bearer <S access>]
body: {"challenge_id":"21a5ca50-7fff-4228-bf6d-f9befd4095ae","code":"<totp>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585641,"refresh_token":"<redacted>","user":{"id":"63930cb6-46a0-4faf-9692-bbe7794a5401","aud":"authenticated","role":"authenticated","email":"editor2@s3.local","email_confirmed_at":"2026-11-02T01:14:01.069679Z","phone":"","confirmed_at":"2026-11-02T01:14:01.069679Z","recovery_sent_at":"2026-11-02T01:14:01.084922Z","last_sign_in_at":"2026-11-02T01:14:01.090423Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"factors":[{"id":"4560333f-a1fb-4b75-847d-6c1f98ba79e6","created_at":"2026-11-02T01:14:01.10313Z","updated_at":"2026-11-02T01:14:01.119137Z","status":"verified","friendly_name":"s3","factor_type":"totp","phone":"","last_challenged_at":"2026-11-02T01:14:01.113526Z"}],"identities":[{"identity_id":"23df17a7-6308-4c52-a8c3-e230093c09db","id":"63930cb6-46a0-4faf-9692-bbe7794a5401","user_id":"63930cb6-46a0-4faf-9692-bbe7794a5401","identity_data":{"email":"editor2@s3.local","email_verified":false,"phone_verified":false,"sub":"63930cb6-46a0-4faf-9692-bbe7794a5401"},"provider":"email","last_sign_in_at":"2026-11-02T01:14:01.069093Z","created_at":"2026-11-02T01:14:01.06912Z","updated_at":"2026-11-02T01:14:01.06912Z","email":"editor2@s3.local"}],"created_at":"2026-11-02T01:14:01.068579Z","updated_at":"2026-11-02T01:14:01.120136Z","is_anonymous":false}}
aal2 session aal=aal2

### new magic-link session for MFA user (aal1): admin generate_link
POST /auth/v1/admin/generate_link  [apikey: <KEY>; Authorization: Bearer <service key>]
body: {"type":"magiclink","email":"editor2@s3.local"}
-> 200 {"id":"63930cb6-46a0-4faf-9692-bbe7794a5401","aud":"authenticated","role":"authenticated","email":"editor2@s3.local","email_confirmed_at":"2026-11-02T01:14:01.069679Z","phone":"","confirmed_at":"2026-11-02T01:14:01.069679Z","recovery_sent_at":"2026-11-02T01:14:01.125229456Z","last_sign_in_at":"2026-11-02T01:14:01.090423Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"factors":[{"id":"4560333f-a1fb-4b75-847d-6c1f98ba79e6","created_at":"2026-11-02T01:14:01.10313Z","updated_at":"2026-11-02T01:14:01.119137Z","status":"verified","friendly_name":"s3","factor_type":"totp","phone":"","last_challenged_at":"2026-11-02T01:14:01.113526Z"}],"identities":[{"identity_id":"23df17a7-6308-4c52-a8c3-e230093c09db","id":"63930cb6-46a0-4faf-9692-bbe7794a5401","user_id":"63930cb6-46a0-4faf-9692-bbe7794a5401","identity_data":{"email":"editor2@s3.local","email_verified":false,"phone_verified":false,"sub":"63930cb6-46a0-4faf-9692-bbe7794a5401"},"provider":"email","last_sign_in_at":"2026-11-02T01:14:01.069093Z","created_at":"2026-11-02T01:14:01.06912Z","updated_at":"2026-11-02T01:14:01.06912Z","email":"editor2@s3.local"}],"created_at":"2026-11-02T01:14:01.068579Z","updated_at":"2026-11-02T01:14:01.125484Z","is_anonymous":false,"action_link":"http://127.0.0.1:54321/auth/v1/verify?token=22c5516f83ed96d59531761cc721e52d46b46be0f165c099adc286f8&type=magiclink&redirect_to=http://localhost:3000","email_otp":"450216","hashed_token":"<redacted>","verification_type":"magiclink","redirect_to":"http://localhost:3000"}

### new magic-link session for MFA user (aal1): verify magiclink token_hash
POST /auth/v1/verify  [apikey: <KEY>]
body: {"type":"magiclink","token_hash":"<hash>"}
-> 200 {"access_token":"<redacted>","token_type":"bearer","expires_in":3600,"expires_at":1793585641,"refresh_token":"<redacted>","user":{"id":"63930cb6-46a0-4faf-9692-bbe7794a5401","aud":"authenticated","role":"authenticated","email":"editor2@s3.local","email_confirmed_at":"2026-11-02T01:14:01.069679Z","phone":"","confirmed_at":"2026-11-02T01:14:01.069679Z","recovery_sent_at":"2026-11-02T01:14:01.125229Z","last_sign_in_at":"2026-11-02T01:14:01.130016199Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"factors":[{"id":"4560333f-a1fb-4b75-847d-6c1f98ba79e6","created_at":"2026-11-02T01:14:01.10313Z","updated_at":"2026-11-02T01:14:01.119137Z","status":"verified","friendly_name":"s3","factor_type":"totp","phone":"","last_challenged_at":"2026-11-02T01:14:01.113526Z"}],"identities":[{"identity_id":"23df17a7-6308-4c52-a8c3-e230093c09db","id":"63930cb6-46a0-4faf-9692-bbe7794a5401","user_id":"63930cb6-46a0-4faf-9692-bbe7794a5401","identity_data":{"email":"editor2@s3.local","email_verified":false,"phone_verified":false,"sub":"63930cb6-46a0-4faf-9692-bbe7794a5401"},"provider":"email","last_sign_in_at":"2026-11-02T01:14:01.069093Z","created_at":"2026-11-02T01:14:01.06912Z","updated_at":"2026-11-02T01:14:01.06912Z","email":"editor2@s3.local"}],"created_at":"2026-11-02T01:14:01.068579Z","updated_at":"2026-11-02T01:14:01.130318Z","is_anonymous":false}}
new session aal=aal1

### MFA user, aal1 FRESH session: password update without nonce
PUT /auth/v1/user  [apikey: <KEY>; Authorization: Bearer <S2 access>]
body: {"password":"<pw>"}
-> 401 {"code":401,"error_code":"insufficient_aal","msg":"AAL2 session is required to update email or password when MFA is enabled."}

### MFA user, aal2 session: password update without nonce
PUT /auth/v1/user  [apikey: <KEY>; Authorization: Bearer <aal2 access>]
body: {"password":"<pw>"}
-> 200 {"id":"63930cb6-46a0-4faf-9692-bbe7794a5401","aud":"authenticated","role":"authenticated","email":"editor2@s3.local","email_confirmed_at":"2026-11-02T01:14:01.069679Z","phone":"","confirmed_at":"2026-11-02T01:14:01.069679Z","last_sign_in_at":"2026-11-02T01:14:01.130016Z","app_metadata":{"provider":"email","providers":["email"]},"user_metadata":{"email_verified":true},"factors":[{"id":"4560333f-a1fb-4b75-847d-6c1f98ba79e6","created_at":"2026-11-02T01:14:01.10313Z","updated_at":"2026-11-02T01:14:01.119137Z","status":"verified","friendly_name":"s3","factor_type":"totp","phone":"","last_challenged_at":"2026-11-02T01:14:01.113526Z"}],"identities":[{"identity_id":"23df17a7-6308-4c52-a8c3-e230093c09db","id":"63930cb6-46a0-4faf-9692-bbe7794a5401","user_id":"63930cb6-46a0-4faf-9692-bbe7794a5401","identity_data":{"email":"editor2@s3.local","email_verified":false,"phone_verified":false,"sub":"63930cb6-46a0-4faf-9692-bbe7794a5401"},"provider":"email","last_sign_in_at":"2026-11-02T01:14:01.069093Z","created_at":"2026-11-02T01:14:01.06912Z","updated_at":"2026-11-02T01:14:01.06912Z","email":"editor2@s3.local"}],"created_at":"2026-11-02T01:14:01.068579Z","updated_at":"2026-11-02T01:14:01.230873Z","is_anonymous":false}
```
