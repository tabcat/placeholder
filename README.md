# limo hijacker 🕴️

client-side verifying ENS/IPFS resolver chrome extension

# How does it work?

The extension uses browser.webRequest.onHeadersReceived to edit the frame-ancestor header from *.eth.limo sites.
Then whenever the user navigates to a .eth or .eth.limo domain the extension redirects to its own url (web-extension://<hash>/resolver.html?<domain>.eth)
Resolver.html registers a service worker to intercept traffic to *.eth.limo and adds an iframe the size of the window with src=<domain>.eth.limo
When the iframe needs to fetch a resource from <domain>.eth.limo the service worker instead queries an ETH RPC and then an ipfs gateway with a verified fetch to resolve the content.

(still a WIP!)
