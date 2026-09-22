import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 以空前缀加载全部变量，兼容 Docker/CI 直接注入的 VITE_* 环境变量。
  const env = loadEnv(mode, process.cwd(), '')
  const amapSecurityJsCode = env.VITE_AMAP_SECURITY_JS_CODE || ''

  return {
    plugins: [
      vue(),
      // 按需自动导入 Ant Design Vue 组件（v4 用 cssinjs 运行时注入样式，无需 importStyle）
      // 将全量 antd 约 1MB 的 vendor 体积缩减为仅用到的组件
      Components({
        dts: false,
        resolvers: [AntDesignVueResolver({ importStyle: false })],
      }),
      {
        // 使用普通占位符，避免触发 Vite 对 %ENV% 的内置扫描告警。
        name: 'tripstar-inject-amap-security-code',
        transformIndexHtml(html: string) {
          return html.replaceAll('__AMAP_SECURITY_JS_CODE__', amapSecurityJsCode)
        },
      },
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            if (id.includes('ant-design-vue') || id.includes('@ant-design') || id.includes('@ctrl/tinycolor')) return 'antd'
            if (id.includes('html2canvas')) return 'html2canvas'
            if (id.includes('amap-jsapi-loader') || id.includes('@googlemaps')) return 'maps'
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true
        }
      }
    }
  }
})
