import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await sleep(2500);
console.log('SCREENS ' + await p.eval('Object.keys(PN.screens).join(",")'));
console.log('GAMES   ' + await p.eval('Object.keys(PN.games).join(",")'));
console.log('GO?     ' + await p.eval('typeof PN.screens.go + " / " + typeof PN.games.go'));
console.log('ERRORS  ' + await p.consoleErrors());
await p.dispose(); cdp.close();
