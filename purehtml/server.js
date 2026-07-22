const http = require("http");
const fs = require("fs");
const path = require("path");

const port = 3000;

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
    let filePath = path.join(
      process.cwd(),
      req.url === "/" ? "index.html" : req.url,
    );

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);

        return res.end("Not found");
      }

      const ext = path.extname(filePath);

      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
      });

      res.end(content);
    });
  })
  .listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
