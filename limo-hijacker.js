import { http } from "viem";
import { mainnet } from "viem/chains";
import { createEnsPublicClient } from "@ensdomains/ensjs";
import { trustlessGateway } from "@helia/block-brokers";
import { createHeliaHTTP } from "@helia/http";
import { delegatedHTTPRouting, httpGatewayRouting } from "@helia/routers";
import { ipns as heliaIpns } from "@helia/ipns";
import { createVerifiedFetch } from "@helia/verified-fetch";
import { peerIdFromString } from "@libp2p/peer-id";

let verifiedFetch, ipns, transport, ensClient;
async function setup() {
  const helia = await createHeliaHTTP({
    blockBrokers: [trustlessGateway()],
    routers: [
      delegatedHTTPRouting("http://delegated-ipfs.dev"),
      httpGatewayRouting({
        gateways: ["https://trustless-gateway.link", "https://dweb.link"],
      }),
    ],
  });

  console.log("setup helia verified-fetch and ipns");
  verifiedFetch = await createVerifiedFetch(helia);
  ipns = heliaIpns(helia);

  const ethRpc = await getEthRPC();
  if (ethRpc) {
    console.log(`ETH RPC set to ${ethRpc}`);
  }
  setENSClient(ethRpc);
  console.log("setup ens client");

  console.log("🕴️ ready to hijack requests to eth.limo 🕴️");
}
setup();

const eth_rpc_key = "eth_rpc";

async function getEthRPC() {
  const obj = await new Promise((resolve) => {
    browser.storage.local.get(eth_rpc_key, resolve);
  });

  return obj[eth_rpc_key];
}

function setENSClient(eth_rpc_value) {
  transport = http(eth_rpc_value);
  ensClient = createEnsPublicClient({
    chain: mainnet,
    transport,
  });
}

const ensCache = new Map();
const ipnsCache = new Map();

async function resolveContent(ethlimoDomainPath) {
  ethlimoDomainPath = new URL(ethlimoDomainPath);

  const ethDomainPath = ethlimoDomainPath.hostname.slice(0, -".limo".length);
  console.log(
    `resolving ${ethDomainPath}${ethlimoDomainPath.pathname} via ens client`
  );
  let { protocolType, decoded } =
    ensCache.get(ethlimoDomainPath) ??
    (await ensClient.getContentHashRecord({ name: ethDomainPath }));

  console.log(`resolved ${ethDomainPath} to ${protocolType}://${decoded}`);

  ensCache.set(ethDomainPath, { protocolType, decoded });

  if (protocolType !== "ipfs" && protocolType !== "ipns") {
    console.error("unsupported protocol type:", protocolType);
    return new Response("unsupported protocol type: " + protocolType);
  }

  if (protocolType === "ipns") {
    console.log(`resolving ${protocolType}://${decoded}`);
    // return new Response("unsupported protocol type: " + protocolType);
    const result =
      ipnsCache.get(decoded) ?? (await ipns.resolve(peerIdFromString(decoded)));

    console.log(
      `resolved ${protocolType}://${decoded} to ipfs://${result.cid
        .toV1()
        .toString()}`
    );
    ipnsCache.set(decoded, result);

    // only handles ipns records with ipfs values, if something else this code will break
    protocolType = "ipfs";
    decoded = result.cid.toV1().toString();
  }

  const fullContentPath = `${protocolType}://${decoded}${ethlimoDomainPath.pathname}`;
  console.log(`resolving ${fullContentPath} via helia verified-fetch`);

  // return [fullContentPath, await verifiedFetch(fullContentPath)]
  return [fullContentPath, await verifiedFetch(fullContentPath)];
}

/**
 * Resolve ens domain to content hash and replace responses from eth.limo with a trustless ipfs gateway
 */
function hijack(details) {
  console.log("intercepted request to:", details.url);
  let filter = browser.webRequest.filterResponseData(details.requestId);

  filter.onstart = (event) => {
    resolveContent(details.url).then(async ([fullContentPath, response]) => {
      if (response.status === 200) {
        console.log(`resolved ${fullContentPath} via helia verified-fetch`);
        filter.write(await response.arrayBuffer());
        filter.close();
      } else {
        console.error(
          `failed to resolve ${fullContentPath} via helia verified-fetch`
        );
        filter.close();
      }
    });
  };

  // throw away response from eth.limo
  filter.ondata = () => {};

  return { canceled: false };
}
browser.webRequest.onBeforeRequest.addListener(
  hijack,
  {
    urls: ["*://*.eth.limo/*"],
    types: [
      "main_frame",
      "sub_frame",
      "stylesheet",
      "script",
      "image",
      "xmlhttprequest",
      "media",
      "other",
    ],
  },
  ["blocking"]
);

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "set " + eth_rpc_key) {
    setENSClient(message.data);
    console.log(`ETH RPC set to ${message.data}`)
  }
});
