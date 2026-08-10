# PAOLO SAXTON — Pantalla de inicio de sesión

Pantalla de acceso personal con un robot 3D animado (Three.js + React Three Fiber) que sigue al cursor, parpadea, reacciona al formulario, asiente al iniciar sesión y niega ante errores.

## Tecnologías

- React 18 + Vite + TypeScript
- Three.js con `@react-three/fiber` y `@react-three/drei`
- CSS responsive puro (sin frameworks adicionales)

## Ejecutar

```bash
npm install
npm run dev
```

Abre http://localhost:5173

## Estructura

```
src/
  components/
    LoginForm.tsx      # Formulario HTML real (correo, contraseña, recordarme)
    RobotScene.tsx     # Canvas, luces, detección WebGL, pausa por visibilidad
    RobotModel.tsx     # Robot construido con geometrías Three.js por grupos
  hooks/
    useMouseTracking.ts   # Cursor/toque normalizado a [-1, 1]
    useRobotAnimation.ts  # Seguimiento, parpadeo, idle, gestos nod/shake
  pages/
    LoginPage.tsx      # Composición y estado compartido robot ⇄ formulario
  styles/
    login.css
```

## Notas

- La cabeza sigue al cursor con límites de ±15° (horizontal) y ±9° (vertical) usando interpolación.
- El robot mira al campo enfocado (correo / contraseña / botón) y baja los párpados en la contraseña.
- `devicePixelRatio` limitado a 1.5; la animación se pausa con la pestaña oculta.
- Respeta `prefers-reduced-motion` y ofrece fallback estático sin WebGL
  (`/public/images/paolo-robot-reference.jpg`).
