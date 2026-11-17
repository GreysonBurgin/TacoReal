# Connecting the owner's editor (once)

The editor page (`/editor.html` on the site) saves to a Google Sheet through a small script that lives on that sheet. The website reads the same sheet. Until this is done the editor runs in demo mode and saves only in the browser.

1. Sign in to the Google account that will own the sheet. Go to sheets.new, then File > Import > Upload `Taco-Website-Editor.xlsx` > Replace spreadsheet.
2. Extensions > Apps Script. Delete what is there and paste all of `setup/editor-backend.gs`.
3. Change `PASSCODE` near the top to something long that only the owner knows.
4. Deploy > New deployment > type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and approve Google's prompt.
5. Copy the web app address (it ends in `/exec`) into `src/data/site.json`, in `"sheet": { "api": "..." }`. Build and publish.

The sheet itself stays private. Only the script can read it, and saving needs the passcode. Eight wrong passcodes lock saving for ten minutes.

After changing the script later: Deploy > Manage deployments > edit > Version: New version.
