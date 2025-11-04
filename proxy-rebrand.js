// proxy-rebrand.js
// npm i express http-proxy-middleware node-fetch
import express from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

const TARGET = 'https://app.heygen.com/home'; // change this
const PORT = 3000;

const app = express();

app.use(
  '/',
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    selfHandleResponse: true, // we'll intercept and modify responses
    onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      const contentType = proxyRes.headers['content-type'] || '';
      let body = responseBuffer.toString('utf8');

      // 1) simple string replacements (fast, but brittle)
      body = body.replace(/HeyGen/gi, 'MyBrand');     // text replacement example
      body = body.replace(/heygen\.com/gi, 'mycdn.example'); // rewrite urls if needed

      // 2) inject your CSS/JS before </head> (or before </body>)
      const inject = `
        <style>
          /* override branding colors + hide original logo by src or alt */
          img[src*="heygen"]{ display:none!important; }
        </style>
        <script>
          // safe client-side DOM rewriting + handle SPA changes
          (function(){
            const repl = () => {
              document.body.innerHTML = document.body.innerHTML.replace(/HeyGen/gi, 'MyBrand');
              // replace images with data-attribute mapping if needed
              document.querySelectorAll('img').forEach(img=>{
                if(img.src && img.src.includes('heygen')) img.src = '/assets/mylogo.png';
              });
            };
            repl();
            // watch for later changes in SPA sites
            new MutationObserver(repl).observe(document.documentElement, {childList:true, subtree:true});
          })();
        </script>
      `;
      if(contentType.includes('text/html')) {
        body = body.replace('</head>', inject + '</head>');
      }

      // 3) remove or rewrite security headers that would break injected scripts (optional)
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];

      return body;
    })
  })
);

app.listen(PORT, ()=> console.log(`Proxy running on http://localhost:${PORT} -> ${TARGET}`));
