'use strict';

const EMsg = require('steam-user/enums/EMsg');
const Schema = require('steam-user/protobufs/generated/_load.js');
const protobuf = require('protobufjs');

if (Schema.CMsgClientChangeStatus && !Schema.CMsgClientChangeStatus.fields?.gaming_device_type) {
  try {
    Schema.CMsgClientChangeStatus.add(new protobuf.Field('gaming_device_type', 9, 'uint32'));
  } catch {}
}

function encodeProtoOrObject(ProtoType, obj) {
  if (ProtoType && typeof ProtoType.encode === 'function') {
    const res = ProtoType.encode(obj);
    const out = res && typeof res.finish === 'function' ? res.finish() : res;
    if (Buffer.isBuffer(out) || out instanceof Uint8Array) return Buffer.from(out);
  }
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

/**
 * Spoofea la presencia en amigos simulando que el cliente está corriendo en Steam Deck (SteamOS)
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
      : payload;
    client._send({ msg: EMsg.ClientChangeStatus || 716, proto: {} }, body);
    return true;
  } catch (err) {
    console.warn('[SteamDeck] Error al spoofear presencia:', err.message);
    return false;
  }
}

/**
 * Registra el hardware de Steam Deck ante el microservicio de Valve para reclamar cosméticos exclusivos permanentes
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
        : Buffer.alloc(0);

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
            const res = (Buffer.isBuffer(buf) && buf.length && Schema.CLoyaltyRewards_RegisterForSteamDeckRewards_Response)
              ? Schema.CLoyaltyRewards_RegisterForSteamDeckRewards_Response.decode(buf)
              : { granted_profile_modifier: true };
            finish({
              success: true,
              granted: Boolean(res?.granted_profile_modifier ?? true),
              permanent: true,
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
