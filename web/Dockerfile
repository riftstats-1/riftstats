# Static download page and CDN for RiftStats.
# The installer is placed in cdn/downloads/ by the pipeline before the build.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site /usr/share/nginx/site
COPY cdn /usr/share/nginx/cdn

EXPOSE 80
