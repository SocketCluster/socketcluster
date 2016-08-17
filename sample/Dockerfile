FROM node:6.3.0-slim
MAINTAINER Jonathan Gros-Dubois

LABEL version="5.0.5"
LABEL description="Docker file for SocketCluster with support for clustering."

RUN mkdir -p /usr/src/
WORKDIR /usr/src/
COPY . /usr/src/

RUN npm install .

EXPOSE 8000

CMD ["npm", "start"]
