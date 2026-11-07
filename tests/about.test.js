import test from 'node:test';
import assert from 'node:assert/strict';
import {aboutMarkup,translatedText} from '../static/about.js';
test('about content follows the selected language with explicit fallback',()=>{
 assert.equal(translatedText({en:'English',ru:'Русский'},'en'),'English');
 assert.equal(translatedText({en:'',ru:'Русский'},'en'),'Русский');
 const html=aboutMarkup({description:{en:'Description'},methods:[{title:{en:'Help'},text:{ru:'Текст'},linkUrl:'https://example.test',linkLabel:{en:'Help us'},imageUrl:'https://example.test/picture.png',imageLink:'https://example.test/support'}]});
 assert.ok(html.includes('Description'));assert.ok(html.includes('Support the project'));assert.ok(html.includes('Текст'));
 assert.ok(html.includes('href="https://example.test/support"'));assert.ok(html.includes('rel="noopener noreferrer"'));assert.ok(html.includes('Help us'));
});
test('about presentation escapes authored text and blocks executable and credential URLs',()=>{
 const html=aboutMarkup({description:{en:'<script>alert(1)</script>'},methods:[{title:{en:'" onmouseover="evil()'},text:{en:'<img onerror=evil()>'},linkUrl:'javascript:alert(1)',imageUrl:'data:image/svg+xml,evil',imageLink:'https://user:password@example.test'}]});
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('href='));
});
