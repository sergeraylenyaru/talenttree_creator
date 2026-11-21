"""Render the actual supplied dummy from four sides for manual orientation review."""
import os
from pathlib import Path
import subprocess
import sys
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
import server
from server_lifecycle import temporary_database,start_server

if __name__=='__main__':
    output=Path(sys.argv[1]);output.parent.mkdir(parents=True,exist_ok=True)
    os.environ['TALENT_LOCAL_WOW_ASSETS']='1'
    with temporary_database() as folder,sync_playwright() as pw:
        bundle=Path(folder)/'inspect.js'
        subprocess.run([str(ROOT/'node_modules/.bin/esbuild'),str(ROOT/'tests/dummy-inspection.js'),'--bundle','--format=esm','--outfile='+str(bundle)],check=True)
        server.DB=str(Path(folder)/'inspect.sqlite');server.initialize();http=server.ArchiveHTTPServer(('127.0.0.1',0),server.Handler);start_server(http)
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page=browser.new_page(viewport={'width':1240,'height':540})
        page.route('**/inspect.js',lambda route:route.fulfill(content_type='text/javascript',body=bundle.read_text()))
        page.route('**/inspect',lambda route:route.fulfill(content_type='text/html',body='<body style="display:flex;color:white;background:#20232a;font-family:Arial"><script type="module" src="/inspect.js"></script></body>'))
        page.goto(f'http://127.0.0.1:{http.server_port}/inspect');page.wait_for_function('document.body.dataset.ready==="true"');page.screenshot(path=output);browser.close()
        print('Rendered actual GLB diagnostic views; review the image to identify the face.')
