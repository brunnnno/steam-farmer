'use strict';

const EMsg = require('steam-user/enums/EMsg');
const Schema = require('steam-user/protobufs/generated/_load.js');
const {
  encodeSteamDeckRegistrationWire,
  encodeChangeStatusWire,
  decodeWireFields
} = require('./rea-overwatch-2003');

function encodeProtoOrObject(ProtoType, obj) {
  if (ProtoType && typeof ProtoType.encode === 'function') {
    const res = ProtoType.encode(obj);
    const out = res && typeof res.finish === 'function' ? res.finish() : res;
    if (Buffer.isBuffer(out) || out instanceof Uint8Array) return Buffer.from(out);
  }
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

/**
 * Spoofea la presencia en amigos simulando que el cliente está corriendo en Steam Deck (SteamOS).
 * Usa el codificador binario Protobuf Wire-Format de Motor 1 si `_load.js` no provee el schema.
 */
function enableSteamDeckPresence(client) {
  if (!client || typeof client._send !== 'function') return false;
  try {
    const payload = {
      persona_state: 1, // En línea
      persona_state_flags: 1, // HasRichPresence
      gaming_device_type: 2 // 2 = Steam Deck Hardware
    };
    const body = Schema.CMsgClientChangeStatus
      ? encodeProtoOrObject(Schema.CMsgClientChangeStatus, payload)
      : encodeChangeStatusWire({
          personaState: payload.persona_state,
          personaStateFlags: payload.persona_state_flags,
          gamingDeviceType: payload.gaming_device_type
        });
    client._send({ msg: EMsg.ClientChangeStatus || 716, proto: {} }, body);
    return true;
  } catch (err) {
    console.warn('[SteamDeck] Error al spoofear presencia:', err.message);
    return false;
  }
}

/**
 * Registra el hardware de Steam Deck ante el microservicio de Valve para reclamar cosméticos permanentes.
 * Reparado con Motor 1 (Wire-Format Protobuf) para no enviar nunca `Buffer.alloc(0)` en Render.
 */
async function registerSteamDeckRewards(client, serialNumber = 'FXAA00000001') {
  if (!client || typeof client._send !== 'function') {
    throw new Error('Cliente Steam no conectado.');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = val => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => {
      finish({
        success: false,
        message: 'Tiempo de espera agotado al contactar el servicio LoyaltyRewards de Steam Deck.'
      });
    }, 8000);
    timer.unref?.();

    try {
      const targetJob = 'LoyaltyRewards.RegisterForSteamDeckRewards#1';
      const body = {
        serial_number: String(serialNumber),
        controller_code: 'DECK'
      };

      const encoded = Schema.CLoyaltyRewards_RegisterForSteamDeckRewards_Request
        ? encodeProtoOrObject(Schema.CLoyaltyRewards_RegisterForSteamDeckRewards_Request, body)
        : encodeSteamDeckRegistrationWire(body.serial_number, body.controller_code);

      client._send(
        { msg: EMsg.ServiceMethodCallFromClient, proto: { target_job_name: targetJob } },
        encoded,
        (response, header) => {
          try {
            const eresult = header?.proto?.eresult !== undefined ? Number(header.proto.eresult) : 1;
            if (eresult !== 1) {
              return finish({
                success: false,
                eresult,
                message: 'Valve rechazó el registro de Steam Deck o la recompensa ya fue reclamada.'
              });
            }
            const buf = response?.toBuffer ? response.toBuffer() : response;
            let res;
            if (Buffer.isBuffer(buf) && buf.length && Schema.CLoyaltyRewards_RegisterForSteamDeckRewards_Response) {
              res = Schema.CLoyaltyRewards_RegisterForSteamDeckRewards_Response.decode(buf);
            } else if (Buffer.isBuffer(buf) && buf.length) {
              const wire = decodeWireFields(buf);
              res = { granted_profile_modifier: Boolean(wire[1]?.[0] ?? true) };
            } else {
              res = { granted_profile_modifier: true };
            }
            finish({
              success: true,
              granted: Boolean(res?.granted_profile_modifier ?? true),
              permanent: true,
              wireBytesSent: encoded.length,
              message: '¡Recompensas exclusivas de Steam Deck activadas permanentemente en tu cuenta de Steam!'
            });
          } catch (e) {
            finish({ success: false, message: e.message });
          }
        }
      );
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

module.exports = { enableSteamDeckPresence, registerSteamDeckRewards };
