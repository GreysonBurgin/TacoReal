# Connecting the owner's editor (once)

The editor page (`/editor.html` on the site) saves to a Google Sheet through a small script that lives on that sheet. The website reads the same sheet. Until this is done the editor runs in demo mode and saves only in the browser.

1. Sign in to the Google account that will own the sheet. Go to sheets.new and give the sheet a name.
2. Extensions > Apps Script. Delete what is there and paste all of `setup/editor-backend.gs`.
3. Change `PASSCODE` near the top to something long that only the owner knows: sixteen characters or more.
4. In the function menu at the top choose **setUp** and press **Run**. Approve Google's prompt. It adds the four tabs the website reads (Menu, Sections, Hours, Info).
5. Deploy > New deployment > type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy.
6. Copy the web app address (it ends in `/exec`) into `src/data/site.json`, in `"sheet": { "api": "..." }`. Build and publish.
7. Open `/editor.html` and enter the passcode. A new sheet is empty, so the editor shows the website as built. Press **Publish** once to fill the sheet.

## What is and is not private
- The sheet itself stays private. Only the script reads it.
- Anyone can read what is on the website through the script: Live and Sold out items, hours, address, links.
- Drafts, Hidden items and saving need the passcode.
- The right passcode always works. Wrong ones are slowed down after eight tries in ten minutes. A long passcode is what makes guessing hopeless.
- Editing the sheet by hand is fine. If the editor is open at the time, it will refuse to save over the change and ask for a reload.

## If a save fails
The script checks the whole save before it changes anything, and puts the sheet back if a save stops part-way. If it ever says it could not undo, open the sheet, File > Version history, and restore the version from before that save.

## After changing the script later
Deploy > Manage deployments > edit > Version: **New version**. Publish the website with the matching `editor.html` first: an editor page from before this version is refused by the newer script, so that it cannot erase Drafts and Hidden items it never saw.

## Moving the sheet to another Google account
Repeat steps 1 to 7 in the new account. In step 7 the editor fills the new sheet from the website as built, so publish the site with its current facts first (or copy the four tabs across by hand).
