# Kings League Scoreboard

Tabellone Kings League con controller, overlay e pagine ledwall sincronizzate via WebSocket.

## Avvio

```bash
npm install
npm start
```

Poi apri:

- Controller: http://127.0.0.1:3000/controller.html
- Overlay: http://127.0.0.1:3000/overlay.html
- Ledwall: http://127.0.0.1:3000/ledwall.html

Puoi cambiare porta con:

```bash
PORT=3001 npm start
```

In locale, se vuoi forzare l'ascolto solo sul tuo computer:

```bash
HOST=127.0.0.1 PORT=3001 npm start
```
