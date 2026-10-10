const fs=require('fs'), path=require('path'), esbuild=require('esbuild');
const header='/**\n * @name MarkdownRender\n * @author sutto4\n * @version 0.2.2\n * @website https://github.com/sutto4/BD-MarkdownRender\n * @source https://github.com/sutto4/BD-MarkdownRender/blob/main/MarkdownRender.plugin.js\n * @description Render full Discord text attachments as Markdown, with tables, nested lists and raw-text mode.\n */\n';
function wrap(file, member='') {
 const code=esbuild.transformSync(fs.readFileSync(path.join(__dirname,file),'utf8'), {format:'cjs',legalComments:'inline',target:'es2022'}).code;
 return `(() => { const module = {exports:{}}; const exports = module.exports;\n${code}\nreturn module.exports${member}; })()`;
}
let source=fs.readFileSync(path.join(__dirname,'src/main.js'),'utf8');
source=source.replace("import {marked} from 'marked';",'const marked = '+wrap('node_modules/marked/lib/marked.esm.js','.marked')+';');
source=source.replace("import DOMPurify from 'dompurify';",'const DOMPurify = '+wrap('node_modules/dompurify/dist/purify.cjs.js')+';');
fs.writeFileSync(path.join(__dirname,'MarkdownRender.plugin.js'), header+source);
console.log('Built MarkdownRender 0.2.2');
const licenseText=['marked','dompurify'].map(name=>name+'\n'+fs.readFileSync(path.join(__dirname,'node_modules',name,'LICENSE'),'utf8')).join('\n\n');
fs.appendFileSync(path.join(__dirname,'MarkdownRender.plugin.js'),'\n/* Bundled dependency licenses\n'+licenseText.replace(/\*\//g,'* /')+'\n*/\n');
