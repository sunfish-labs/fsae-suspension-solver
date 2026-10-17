# team/

`settings.enc` goes here: the team settings (learning mode, released designs, banner), encrypted with the team
passphrase. Make it in the app (⚙ Settings → Team, as admin → Download settings.enc), put it here, commit and push;
`ui/build.py` builds it into the page. Without it the app runs with everything on. See
[../TEAM_SETTINGS_PLAN.md](../TEAM_SETTINGS_PLAN.md).
