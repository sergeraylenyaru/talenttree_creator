def open_icons(page):
    button=page.locator('#toggleIconPicker')
    button.wait_for(state='visible')
    if button.get_attribute('aria-expanded')!='true':
        button.click()
