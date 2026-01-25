
#!/data/data/com.termux/files/usr/bin/bash

echo "--- NEXUS CORE: INICIANDO INSTALACIÓN EN TERMUX ---"

# Actualizar paquetes
pkg update -y && pkg upgrade -y

# Instalar Node.js
pkg install nodejs -y

# Informar al usuario
echo "--- NODE.JS INSTALADO ---"
echo "Instalando servidor de despliegue..."

# Instalar 'serve' globalmente para manejar el ruteo de la PWA
npm install -g serve

echo "--- CONFIGURACIÓN COMPLETADA ---"
echo "Para iniciar Nexus, ejecuta: npm start"
echo "Luego abre en tu navegador: http://localhost:3000"

# Iniciar automáticamente
npm start
