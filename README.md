# Mouhijärven kirkko ICS

Sastamalan seurakunnan Mouhijärven jumalanpalvelukset ICS-kalenterina, seurakunnan sivuston [JSON-datasta](https://sastamalanseurakunta.fi/wp-json/custom/v1/events?per_page=100) muunnettuna.  
[GitHub Action](.github/workflows/update-ics.yml) päivittää `feed.ics`-tiedoston kerran vuorokaudessa, joten sen [URL:n](https://www.jukkapajarinen.com/MouhijarvenKirkkoICS/feed.ics) voi lisätä esim. Google kalenteriin.

Syötteeseen poimitaan tapahtumat, joiden seurakunta on Mouhijärvi ja kategoria Jumalanpalvelukset ja uskonelämä (vastaa [tapahtumahaun](https://sastamalanseurakunta.fi/tapahtumahaku/?filter_srk_tax%5B%5D=73&filter_pwd_events_category%5B%5D=82) suodattimia).

Syötteen voi generoida myös paikallisesti (Node.js 20+):

```sh
node scripts/generate-ics.js
```

## Author

- [Jukka Pajarinen](https://www.jukkapajarinen.com)

## [License](LICENSE.md)

Copyright (c) 2026 Jukka Pajarinen

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
