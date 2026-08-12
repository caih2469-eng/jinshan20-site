document.addEventListener('DOMContentLoaded', () => {
            // iOS WeChat can ignore the viewport scale lock while a gesture is active.
            document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
            document.addEventListener('gesturechange', (event) => event.preventDefault(), { passive: false });
            document.addEventListener('gestureend', (event) => event.preventDefault(), { passive: false });
            document.addEventListener('touchmove', (event) => {
                if (event.touches.length > 1) event.preventDefault();
            }, { passive: false });

            const intro = document.getElementById('cinematic-intro');
            const ambient = document.getElementById('ambient');
            const vignette = document.getElementById('vignette');
            const uiLayer = document.getElementById('ui-layer');
            const bgStars = document.getElementById('bg-stars');
            const glow = document.getElementById('glow');
            const loginForm = document.getElementById('login-form');
            const loginError = document.getElementById('login-error');
            const userAgent = navigator.userAgent || '';
            const constrainedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
                || matchMedia('(hover: none)').matches
                || matchMedia('(pointer: coarse)').matches
                || /iP(?:hone|ad|od)|MicroMessenger|MQQBrowser|QQ\//i.test(userAgent);
            if (constrainedMotion) document.documentElement.classList.add('reduced-effects');
            let loginPending = false;

            loginForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (loginPending) return;
                loginPending = true;
                const button = loginForm.querySelector('.btn-submit');
                button.disabled = true;
                button.textContent = '登录中';
                loginError.textContent = '';
                // Warm the authenticated landing document alongside login, never during entrance first paint.
                window.__START_HOME_DOCUMENT_PREFETCH__?.();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                try {
                    const values = Object.fromEntries(new FormData(loginForm));
                    const response = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(values),
                        signal: controller.signal
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || '登录失败');
                    try {
                        localStorage.setItem('token', result.token);
                        localStorage.setItem('user', JSON.stringify(result.user));
                    } catch {
                        // Login still works through the HttpOnly cookie in restricted WebViews.
                    }
                    // A stalled speculative home request must never hold the real navigation open.
                    await window.__SETTLE_HOME_DOCUMENT_PREFETCH__?.();
                    /* LOGIN_BOOTSTRAP_HANDOFF_V2 */
                    try {
                        const bootstrap = result.bootstrap;
                        if (bootstrap?.ok
                            && bootstrap.user?.id
                            && bootstrap.user.id === result.user?.id
                            && bootstrap.dashboard) {
                            sessionStorage.setItem("jinshan20.loginBootstrap.v2", JSON.stringify({
                                savedAt: Date.now(),
                                userId: result.user.id,
                                data: bootstrap
                            }));
                        } else {
                            sessionStorage.removeItem("jinshan20.loginBootstrap.v2");
                        }
                    } catch {}
                    location.replace('/');
                } catch (error) {
                    loginError.textContent = error.name === 'AbortError' ? '登录请求超时，请检查网络后重试。' : error.message;
                    loginPending = false;
                    button.disabled = false;
                    button.textContent = '确 认';
                } finally {
                    clearTimeout(timeout);
                }
            });
            /* STRICT_P95_LOGIN_READY_V4 */
            // Login controls are part of the critical path. Keep the cinematic layer decorative, never blocking input.
            intro.style.pointerEvents = 'none';
            intro.style.zIndex = '5';
            uiLayer.style.transition = 'none';
            uiLayer.style.opacity = '1';
            uiLayer.style.transform = 'translateY(0)';
            requestAnimationFrame(() => {
                ambient.style.opacity = '1';
                vignette.style.opacity = '1';
                bgStars.style.opacity = '1';
                glow.style.opacity = '1';
                setTimeout(() => { intro.style.opacity = '0'; }, 250);
            });

            if (!constrainedMotion) document.addEventListener('mousemove', (e) => {
                glow.style.left = e.clientX + 'px';
                glow.style.top = e.clientY + 'px';
            });

            // 1. 生成高密度、有大小层次的静态繁星 (数量180颗，大小扩大到1px - 4.5px)
            for(let i = 0; i < (constrainedMotion ? 36 : 180); i++) {
                let star = document.createElement('div');
                star.className = 'star';
                star.style.left = Math.random() * 100 + 'vw';
                star.style.top = Math.random() * 100 + 'vh';

                // 制造大小不一的视觉空间感 (有微小星、中等星、耀眼大星)
                let size = Math.random() * 3.5 + 1;
                star.style.width = size + 'px';
                star.style.height = size + 'px';

                star.style.animationDuration = (Math.random() * 3.5 + 1.5) + 's';
                star.style.animationDelay = Math.random() * 3 + 's';
                bgStars.appendChild(star);
            }

            // 2. 生成缓慢漂浮的环境星尘粒子
            for(let i = 0; i < (constrainedMotion ? 0 : 70); i++) {
                let particle = document.createElement('div');
                particle.className = 'floating-particle';
                particle.style.left = Math.random() * 100 + 'vw';
                particle.style.top = Math.random() * 100 + 'vh';

                let size = Math.random() * 3.5 + 1.5;
                particle.style.width = size + 'px';
                particle.style.height = size + 'px';
                bgStars.appendChild(particle);

                const xMove = (Math.random() - 0.5) * 180;
                const yMove = (Math.random() - 0.5) * 180;

                particle.animate([
                    { transform: 'translate(0,0)', opacity: 0 },
                    { opacity: Math.random() * 0.6 + 0.2, offset: 0.5 },
                    { transform: `translate(${xMove}px, ${yMove}px)`, opacity: 0 }
                ], {
                    duration: Math.random() * 12000 + 8000,
                    easing: 'linear',
                    iterations: Infinity,
                    delay: Math.random() * 5000
                });
            }

            // 3. 增强版动态流星雨 (数量增多、大小与速度各异)
            function createBgMeteor() {
                const meteor = document.createElement('div');
                meteor.className = 'bg-shooting-star';

                const startX = (Math.random() - 0.2) * window.innerWidth;
                const startY = (Math.random() - 0.5) * window.innerHeight;
                meteor.style.left = startX + 'px';
                meteor.style.top = startY + 'px';

                // 随机流星尺寸（长度 60px 到 220px 错落有致）
                meteor.style.width = (Math.random() * 160 + 60) + 'px';

                // 随机飞行速度（1.0秒 到 2.2秒 产生快慢错落）
                const duration = Math.random() * 1.2 + 1.0;
                meteor.style.animationDuration = duration + 's';

                bgStars.appendChild(meteor);
                setTimeout(() => meteor.remove(), duration * 1000);
            }

            // 缩短触发间隔，大幅增加流星出现频率
            if (!constrainedMotion) setTimeout(() => {
                setInterval(() => {
                    // 提高生成触发概率到 85%
                    if (Math.random() > 0.15) {
                        createBgMeteor();
                    }
                }, 600); // 频率缩短至 600ms，让流星雨更频繁
            }, 1000);
        });
