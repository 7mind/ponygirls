import { createServer } from "node:http";
import { once } from "node:events";

export async function piCatalogFixture(t) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(404);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { catalogBaseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}
