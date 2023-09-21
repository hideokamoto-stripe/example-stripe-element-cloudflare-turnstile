import { Hono } from 'hono'
import { FC } from 'hono/jsx';
import { html } from 'hono/html';
import Stripe from 'stripe';
import { HTTPException } from 'hono/http-exception';

type TurnstileResult = {
    success: boolean;
    challenge_ts: string;
    hostname: string;
    'error-codes': Array<string>;
    action: string;
    cdata: string;
}
type Bindings = {
    TURNSTILE_SITE_KEY: string;
    STRIPE_PUBLISHABLE_KEY: string;
    STRIPE_SECRET_KEY: string;
    TURNSTILE_SECRET_KEY: string;
}
const app = new Hono<{
    Bindings: Bindings
}>()



const Top:FC<{
    TURNSTILE_SITE_KEY: string;
    STRIPE_PUBLISHABLE_KEY: string;
}> = ({TURNSTILE_SITE_KEY: siteKey, STRIPE_PUBLISHABLE_KEY: stripePublishableKey}) => {
    
    return (
        <html>
            <head>
                <title>Turnstile &dash; Dummy Login Demo</title>
                <style>
                    {html`
                html,
                body {
                    height: 100%;
                }

                body {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding-top: 40px;
                    padding-bottom: 40px;
                    background-color: #fefefe;
                }
                form > * {
                    margin-bottom: 20px;
                }
                    `}
                </style>
            </head>
            <body>
                <form id="payment-form">
                    <div id="payment-element"></div>
                    <div id="address-element"></div>
                    <div id="result"></div>
                    <div class="cf-turnstile" data-sitekey={`${siteKey}`}></div>
                    <button type="submit" >Order</button>
                </form>
                {html`
                    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_turnstileCb" async defer></script>
                    <script src="https://js.stripe.com/v3/"></script>
                    <script>
                        let turnstileToken = '';
                        let submitButon = document.querySelector("button[type='submit']");
                        const resultElement = document.getElementById('result');
                        function _turnstileCb() {
                            turnstile.render('.cf-turnstile', {
                                callback: function(token) {
                                    turnstileToken = token;
                                    submitButon.removeAttribute('disabled');
                                },
                            })
                        }
                        const stripe = Stripe('${stripePublishableKey}');
                        const elementsAppearance = {
                            theme: 'stripe'
                        }
                        const options = {
                            mode: 'payment',
                            amount: 1000,
                            currency: 'jpy',
                            appearance: elementsAppearance,
                        };
                        const elements = stripe.elements(options);
                        const paymentElement = elements.create('payment');
                        paymentElement.mount('#payment-element');
                        const addressElement = elements.create('address', {
                            mode: 'billing',
                            appearance: elementsAppearance,
                        });
                        addressElement.mount('#address-element');

                        const paymentForm = document.getElementById('payment-form')
                        paymentForm.addEventListener('submit', async e => {
                            e.preventDefault();
                            if (!turnstileToken) return;
                            if (submitButon) {
                                submitButon.setAttribute('disabled', true);
                            }
                            const { error: submitError } = await elements.submit();
                            if (submitError) {
                                console.log(submitError);
                                submitButon.removeAttribute('disabled');
                                return;
                            }
                            const response = await fetch('/payment-intent', {
                                method: "POST",
                                body: JSON.stringify({
                                    turnstileToken,
                                })
                            })
                            if (!response.ok) {
                                const turnstileError = await response.json();
                                resultElement.innerHTML = JSON.stringify(turnstileError, null, 2);
                                return;
                            }
                            const { client_secret: clientSecret } = await response.json();
                            const { error: confirmationError } = await stripe.confirmPayment({
                                elements,
                                clientSecret,
                                confirmParams: {
                                    return_url: 'http://localhost:8787'
                                }
                            });
                            if (submitButon) {
                                submitButon.removeAttribute('disabled');
                            }
                            console.log(confirmationError);
                            resultElement.innerHTML = JSON.stringify(confirmationError, null, 2);
                        })
                    </script>
                    `}
            </body>
        </html>
    )
}

app.get('/', (c) => {
    return c.html(<Top STRIPE_PUBLISHABLE_KEY={c.env.STRIPE_PUBLISHABLE_KEY} TURNSTILE_SITE_KEY={c.env.TURNSTILE_SITE_KEY}/>)
})


app.post('/payment-intent', async c => {
    const body = await c.req.json();
    const ip = c.req.header('CF-Connecting-IP')
    const formData = new FormData();
    formData.append('secret', c.env.TURNSTILE_SECRET_KEY);
    formData.append('response', body.turnstileToken);
    formData.append('remoteip', ip || '');
    const turnstileResult = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        body: formData,
        method: 'POST',
    });
    const outcome = await turnstileResult.json<TurnstileResult>();    
    /**
     * Remove the comment out if you want to block payment if the Turnstile returns the error
     *
     * if (!outcome.success) {
     *     throw new HTTPException(401, {
     *         message: JSON.stringify(outcome)
     *     });
     * }
     **/
    

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
        apiVersion: '2023-08-16',
        appInfo: {
            name: 'qiita-example/cloudflare-turnstile-example'
        }
    });
    const paymentIntent = await stripe.paymentIntents.create({
        amount: 1000,
        currency: 'jpy',
        metadata: {
            turnstile_result: outcome.success ? 'success' : 'failed',
            turnstile_challenge_ts: outcome.challenge_ts,
        },
        payment_method_options: {
            card: {
                request_three_d_secure: outcome.success ? 'automatic' : 'any',
            }
        }
    });
    return c.json({
        client_secret: paymentIntent.client_secret
    });
});

export default app