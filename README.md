# T/aco — website redesign

An accessibility and usability redesign of T/aco's website (1175 Walnut St, Boulder), by Greyson Burgin for ATLS-CSCI 3150 at CU Boulder.

This is a design concept. It is not the official T/aco website, which is at https://tacocolorado.com.

## Run it

    python3 build.py --serve

Builds the site into `dist/` and serves it at http://localhost:8080. Needs only Python 3. Source changes rebuild on the next page load.

## What is where

| Folder | Holds |
|---|---|
| `src/pages/` | One file per page: the part between the header and the footer |
| `src/partials/` | The page frame, header and footer, written once |
| `src/css/` | Shared styles (joined into `site.css`) and each page's own styles |
| `src/js/` | Menus and in-page links, placing the facts on the page, reading the owner's sheet |
| `src/data/` | `site.json` and `menu.json`: every fact that appears in more than one place |
| `src/static/` | Images, fonts, video |
| `src/editor/` | The owner's editor |
| `setup/` | How to host it, connect the editor, and a one-page guide for the owner |
| `loop/` | Project notes |

## Pages

Home · Menu · Catering · Private Events · Famous for Something · Secret Menu · Privacy

## Status

Phone and desktop layouts. The desktop layout is drawn at 1600 px and scaled to fit the window; a fluid rebuild is planned next, with analytics.
