const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function (file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            if (!file.includes('node_modules') && !file.includes('dist')) {
                results = results.concat(walk(file));
            }
        } else {
            if (file.endsWith('.tsx') || file.endsWith('.ts')) results.push(file);
        }
    });
    return results;
}

const files = walk('.');
let changedCount = 0;

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const original = content;

    // Replace yc-orange with yc-purple
    content = content.replace(/yc-orange/g, 'yc-purple');

    // Replace standard orange classes with purple classes
    content = content.replace(/orange-50\b/g, 'purple-50');
    content = content.replace(/orange-100\b/g, 'purple-100');
    content = content.replace(/orange-200\b/g, 'purple-200');
    content = content.replace(/orange-300\b/g, 'purple-300');
    content = content.replace(/orange-400\b/g, 'purple-400');
    content = content.replace(/orange-500\b/g, 'purple-500');
    content = content.replace(/orange-600\b/g, 'purple-600');
    content = content.replace(/orange-700\b/g, 'purple-700');
    content = content.replace(/orange-800\b/g, 'purple-800');
    content = content.replace(/orange-900\b/g, 'purple-900');

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        changedCount++;
        console.log('Updated', file);
    }
});
console.log('Changed', changedCount, 'files');
