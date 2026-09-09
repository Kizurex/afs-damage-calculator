# AFS Damage Calculator

A damage calculator for Anime Fighting Simulator. Pick a move, set up your loadout
(target, stats, champion, title, accessories, transformation, stand) and see exact damage,
hit counts, timings, hitbox sizes and status effects. Rank every move for your build in
**Compare**, or chain moves in **Combo** to see total damage, timing, cooldowns and bleed
stacking.

The site is fully static: no build step, no server. Open `index.html` in a browser or
visit the GitHub Pages deployment.

## Publishing with GitHub Pages

1. Push this repository to GitHub as a **public** repository.
2. Open **Settings → Pages**.
3. Under *Build and deployment* choose **Deploy from a branch**, select `main` and the
   `/ (root)` folder, then save.
4. The site goes live at `https://<username>.github.io/<repository>/` after a minute.

Every push to `main` redeploys automatically.

## Updating the data

`data/gamedata.js` is generated from the game source and copied here together with the
site files. Regenerate it from the game repository and commit the result; nothing else
needs to change.

## Layout

| Path               | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `index.html`       | Page shell, theme bootstrap and script tags                    |
| `styles.css`       | Light and dark themes, layout and components                   |
| `js/engine.js`     | Damage engine (target modes, boosts, statuses, combo simulation) |
| `js/app.js`        | Interface: move browser, move card, compare table, combo builder, loadout form |
| `data/gamedata.js` | Generated move, special, champion, accessory, title and boss data |
| `assets/icons/`    | Move, special and champion icons as `<asset id>.png`             |
