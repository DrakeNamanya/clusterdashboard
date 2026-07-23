// TLS CA certificate for the Oracle VM PostgreSQL server (self-signed, CN/SAN =
// 51.170.135.225, valid to 2036). Cloudflare `workerd` verifies the server's
// certificate chain at the socket layer and IGNORES pg's
// `ssl.rejectUnauthorized:false`, so a bare self-signed cert is rejected with
// "TLS peer's certificate is not trusted". Passing this cert as `ssl.ca` makes
// workerd trust it, giving a stable verified connection in production.
//
// To rotate: regenerate on the VM with an IP SAN and replace this constant:
//   openssl req -new -x509 -days 3650 -nodes \
//     -out /etc/ssl/certs/pg-server.crt -keyout /etc/ssl/private/pg-server.key \
//     -subj "/CN=51.170.135.225" -addext "subjectAltName=IP:51.170.135.225"
export const ORACLE_PG_CA = `-----BEGIN CERTIFICATE-----
MIIDLzCCAhegAwIBAgIUOFofoev93rEZ/GNo1t2XfCk3n9MwDQYJKoZIhvcNAQEL
BQAwGTEXMBUGA1UEAwwONTEuMTcwLjEzNS4yMjUwHhcNMjYwNzIzMTIzNzE4WhcN
MzYwNzIwMTIzNzE4WjAZMRcwFQYDVQQDDA41MS4xNzAuMTM1LjIyNTCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBAJrZogF1Rcs6PkONLkz8fNIneYagtDJA
PLpGSo/IYBxtLuaf9ybhJI2EOsF5+lAcJI97G/AwfenaQv5mHMhOim6O1lb8KvwA
ntP9x3zkONYeZmUO+q86nUb1nL7VTh6HNwFg806Rw25Pb3Iz93aIMIJXI8v/aR3c
V9uTBxTZ7dXeZOfp777dhE3eIDS1BKDJcSUdQZ7pMQSQG6aknaGonSEXSmvjL8Ql
9MTG2+5qN102/lTcX0qrBmUsvdSDMhC7eTzUUnSnOQ/Ech/wjAQlAIPDDqs7O1yq
fckcTfye9MKUml+s96o8sGVwbcY27QPI9ZyRUd+Ug4ZzWcjYMdoI7OECAwEAAaNv
MG0wHQYDVR0OBBYEFNonVGvNOBYuhdXryoCwNfK9dN5AMB8GA1UdIwQYMBaAFNon
VGvNOBYuhdXryoCwNfK9dN5AMA8GA1UdEwEB/wQFMAMBAf8wGgYDVR0RBBMwEYcE
M6qH4YIJb3JhY2xlLXBnMA0GCSqGSIb3DQEBCwUAA4IBAQB6pbPmY8JYY2zp0dhg
761Ej/82CA7P4ot49hcekp+OKiPF2vK+sDiryJvcanWEXxUJzlayHArcAe+I2w5g
FGX6f2wuWbvDyN6VInxh/PW8PBTsRYq2OLIOwVn9BTp+PTpa2gTa/1b888UM84U9
hDa9kdsNgrXTqjlM6rD+MEP/mevHOF7DYkb3EoYc4xpMdjNKhuArWabFPmnXcy6d
H/dV7ReX21TkGZDGO2JT+zhWpRSMC1fF7B8oCOQPZar7LcuJRZf28a1FYVXvG0I1
mqj2qTZpombwiqGG/s5eYjYrtvpJTVCmgjFlmyUT2xRep4NJ1btX4si7lex55qLg
qzDL
-----END CERTIFICATE-----`;

/** Host whose IP is embedded in the cert's CN/SAN (for tls servername). */
export const ORACLE_PG_HOST = '51.170.135.225';
