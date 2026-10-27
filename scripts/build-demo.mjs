// Builds the demo and writes dist-demo/next-team-demo.html: one self-contained page (inline CSS + JS).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', ['vite', 'build', '-c', 'vite.demo.config.ts'], { stdio: 'inherit' });
const js = readFileSync('dist-demo/demo.js', 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = readFileSync('dist-demo/demo.css', 'utf8');
const html = `<title>Next Team</title>
<style>
${css}
body { padding: 0; }
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync('dist-demo/next-team-demo.html', html);
console.log(`dist-demo/next-team-demo.html  ${(html.length / 1024).toFixed(0)} KiB`);
