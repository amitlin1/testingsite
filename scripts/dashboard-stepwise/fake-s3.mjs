import http from "node:http"; import crypto from "node:crypto";
const store = new Map();
http.createServer((req, res) => {
  const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
    const u = new URL(req.url, "http://x"); const parts = u.pathname.split("/").filter(Boolean);
    if (u.searchParams.has("location")) { res.writeHead(200, {"content-type":"application/xml"}); return res.end('<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>'); }
    if (parts.length <= 1) { res.writeHead(200); return res.end(); }
    const key = parts.join("/");
    if (req.method === "PUT") { const b = Buffer.concat(chunks); store.set(key, b); const etag = crypto.createHash("md5").update(b).digest("hex"); res.writeHead(200, { ETag: `"${etag}"` }); return res.end(); }
    const b = store.get(key);
    if (!b) { res.writeHead(404, {"content-type":"application/xml"}); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
    if (req.method === "HEAD") { res.writeHead(200, {"content-length": b.length, ETag: '"x"', "last-modified": new Date().toUTCString()}); return res.end(); }
    if (req.method === "DELETE") { store.delete(key); res.writeHead(204); return res.end(); }
    res.writeHead(200, {"content-length": b.length}); res.end(b);
  });
}).listen(9000, () => console.log("fake s3 on 9000"));
