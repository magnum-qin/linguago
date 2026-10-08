# Jump-host dictionary task credential

The jump host accepts SSH key authentication, but an SSH session is not an
interactive Windows desktop session. The dictionary runner uses Task Scheduler
so a long model job survives SSH disconnects. Its prior `Interactive` task
could not start when `query user` showed no signed-in users.

`scripts/set-remote-dictionary-task-credential.ps1` now stores the `James`
password only as Windows LocalMachine-DPAPI ciphertext in
`D:\linguago-runner\state\secrets\dictionary-task-credential.dpapi`. The
directory ACL allows only `James`, SYSTEM, and Administrators. `state/` is Git
ignored; neither the password nor this ciphertext belongs in a commit, runner
manifest, log, or another computer's backup. LocalMachine DPAPI is machine
bound, and local administrators can decrypt it; it is not a replacement for
host security.

To initialize or rotate the credential, SSH to `ts-win-jump` and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\set-remote-dictionary-task-credential.ps1
```

Enter the password at the hidden prompt. Do not pass it as a command-line
argument. The runner imports the ciphertext only while registering a
password-logon scheduled task, clears temporary byte arrays, and never writes
plaintext to disk. If the Windows password changes, rerun initialization before
the next production start. A password shared in chat should be rotated after
the recovery is stable.

On 2026-09-22, a separate password-logon task launched Node ESM without any
interactive user session. Run `v220-additional-recovery-b19-20260918-023154`
then resumed through the normal scheduled-task path. Its source-review
checkpoint reached 20 reviewed rows (17 approved, 3 rejected, no format or
network failures). This is a draft-only run; the production database and D1
remain on the b18/v218 boundaries until the normal review and audit gates pass.
