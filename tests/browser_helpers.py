def open_icons(page):
    button=page.locator('#toggleIconPicker')
    button.wait_for(state='visible')
    if button.get_attribute('aria-expanded')!='true':
        button.click()


def close_icons(page):
    dialog=page.locator('#iconDialog')
    if dialog.count() and dialog.is_visible():
        page.locator('#closeIconDialog').click()
